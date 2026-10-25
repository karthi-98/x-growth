import { spawnSync } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebReadableStream } from "node:stream/web"

import { APP_NAME } from "../app"
import { extractArchive, parseSums, sha256File } from "./archive"
import { restoreBackup } from "./backup"
import { readLauncher, removeDir, sleep, stopLauncher } from "./instance"
import { appVersion, getLayout, installRoot, readRelease, type Layout } from "./layout"
import { acquireLock, type LockInfo } from "./lock"
import { createLogger } from "./log"
import { absoluteDataDir, runtimePaths } from "./paths"
import { bunPath, platformId } from "./platform"
import { assetName, compareVersions, fetchRelease } from "./releases"

/*
 * `xstats update` (docs/ARCHITECTURE.md section 9): download the release
 * bundle for this OS from GitHub, verify its SHA-256, back up the database,
 * swap the app folder (data/ is never touched), run migrations and restart.
 * If migrations or the restart fail, the old app folder and the database
 * backup are put back.
 *
 * This process never opens the database (backup and migrations run as child
 * processes): on Windows libSQL keeps the file locked until the process
 * exits, which would make the rollback's restore impossible.
 */

async function download(url: string, dest: string) {
  const res = await fetch(url, { headers: { "User-Agent": `x-growth/${appVersion()}` }, signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`)
  const partial = `${dest}.partial`
  await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(partial))
  renameSync(partial, dest)
}

/** Rename, retrying while antivirus or an indexer briefly holds files (Windows). */
async function renameWithRetry(from: string, to: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 30 || !["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(code ?? "")) throw err
      await sleep(500)
    }
  }
}

async function removeWithRetry(dir: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      if (attempt >= 10) throw err
      await sleep(500)
    }
  }
}

/** Run an xstats command in a child process and return its --json result. */
function runCli(cli: string, args: string[], cwd: string, timeoutMs = 120_000): Record<string, unknown> {
  const bun = bunPath()
  if (!bun) throw new Error("Bun was not found.")
  const r = spawnSync(bun, [cli, ...args, "--json"], {
    cwd,
    env: { ...process.env, XSTATS_DATA_DIR: absoluteDataDir() },
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  })
  const last = (r.stdout ?? "").trim().split(/\r?\n/).pop() ?? ""
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(last) as Record<string, unknown>
  } catch {
    // Not JSON: reported below.
  }
  if (r.error || r.status !== 0 || !json || json.status === "failed") {
    const detail = (json?.error as string | undefined) ?? (r.stderr || r.stdout || r.error?.message || "").trim().slice(-1500)
    throw new Error(`"xstats ${args.join(" ")}" failed: ${detail}`)
  }
  return json
}

export const updateSteps = ["download", "verify", "extract", "validate", "backup", "stop", "swap", "migrate", "start", "cleanup"] as const
export type UpdateStep = (typeof updateSteps)[number]

export type UpdateOptions = {
  layout?: Layout
  /** Install this archive instead of downloading (testing, offline installs). */
  fromFile?: string
  /** Expected SHA-256 for fromFile; otherwise read from SHA256SUMS next to it. */
  sha256?: string
  /** Install this version instead of the latest. */
  version?: string
  /** Download, verify, extract and validate only; change nothing. */
  dryRun?: boolean
  /** Reinstall even if the version isn't newer. */
  force?: boolean
  /** Testing: fail on purpose at this step to exercise the rollback. */
  simulateFailure?: "migrate" | "start"
  /** Progress lines for the console. */
  onProgress?: (line: string) => void
}

export type UpdateResult = {
  status: "updated" | "up-to-date" | "dry-run" | "rolled-back"
  from: string
  to: string | null
  steps: { step: UpdateStep; detail: string }[]
  /** Steps a real run would take next (dry run only). */
  plan?: UpdateStep[]
  backup?: string | null
  url?: string
  error?: string
}

export async function applyUpdate(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const layout = opts.layout ?? getLayout()
  const platform = platformId()
  if (!platform) throw new Error(`There is no ${APP_NAME} bundle for ${process.platform}-${process.arch}.`)
  const from = appVersion(layout.appDir)
  const log = createLogger("update")
  const steps: UpdateResult["steps"] = []
  const done = (step: UpdateStep, detail: string) => {
    steps.push({ step, detail })
    log.info(`${step}: ${detail}`)
    opts.onProgress?.(`✓ ${step}: ${detail}`)
  }

  const locked = acquireLock<LockInfo>(runtimePaths.updateLock, {})
  if (!locked.ok) throw new Error(`Another update is already running (pid ${locked.holder.pid}).`)
  const staging = layout.kind === "bundle" ? path.join(installRoot(layout), "app.new") : path.join(runtimePaths.updates, "app.new")
  let downloaded: string | null = null
  try {
    log.info(`Update started from ${from} (${layout.kind}, ${layout.appDir})`)

    // Resolve and download.
    let archive: string
    let expected: string | undefined
    if (opts.fromFile) {
      archive = path.resolve(opts.fromFile)
      if (!existsSync(archive)) throw new Error(`No such file: ${archive}`)
      const sumsFile = path.join(path.dirname(archive), "SHA256SUMS")
      expected = opts.sha256?.toLowerCase() ?? (existsSync(sumsFile) ? parseSums(readFileSync(sumsFile, "utf8")).get(path.basename(archive)) : undefined)
      if (!expected) throw new Error(`No checksum for ${path.basename(archive)}: put SHA256SUMS next to it or pass --sha256.`)
      done("download", `using ${archive}`)
    } else {
      const remote = await fetchRelease(opts.version)
      if (!opts.force && !opts.version && compareVersions(remote.version, from) <= 0) {
        return { status: "up-to-date", from, to: remote.version, steps }
      }
      const name = assetName(remote.version, platform)
      const asset = remote.assets.find((a) => a.name === name)
      if (!asset) throw new Error(`Release ${remote.tag} has no bundle for ${platform} (${name}).`)
      const sumsAsset = remote.assets.find((a) => a.name === "SHA256SUMS")
      if (!sumsAsset) throw new Error(`Release ${remote.tag} has no SHA256SUMS; refusing to install it unverified.`)
      const sumsRes = await fetch(sumsAsset.url, { signal: AbortSignal.timeout(30_000) })
      if (!sumsRes.ok) throw new Error(`Could not download SHA256SUMS: ${sumsRes.status}`)
      expected = parseSums(await sumsRes.text()).get(name)
      if (!expected) throw new Error(`SHA256SUMS has no entry for ${name}.`)
      mkdirSync(runtimePaths.updates, { recursive: true })
      archive = path.join(runtimePaths.updates, name)
      if (!existsSync(archive) || (await sha256File(archive)) !== expected) await download(asset.url, archive)
      downloaded = archive
      done("download", `${name} (${(statSync(archive).size / 1024 / 1024).toFixed(1)} MB) from ${remote.tag}`)
    }

    const actual = await sha256File(archive)
    if (actual !== expected) {
      if (downloaded) rmSync(downloaded, { force: true })
      throw new Error(`Checksum mismatch for ${path.basename(archive)} (expected ${expected}, got ${actual}). Nothing was installed.`)
    }
    done("verify", `SHA-256 ${actual}`)

    await removeWithRetry(staging)
    extractArchive(archive, staging)
    done("extract", staging)

    const release = readRelease(staging)
    if (!release) throw new Error(`${path.basename(archive)} has no release.json; it isn't an ${APP_NAME} bundle.`)
    if (release.platform !== platform) throw new Error(`That bundle is for ${release.platform}; this computer needs ${platform}.`)
    for (const f of ["xstats.js", "worker.js", "server.js", "server-entry.mjs", path.join("drizzle", "meta", "_journal.json")]) {
      if (!existsSync(path.join(staging, f))) throw new Error(`The bundle is missing ${f}.`)
    }
    if (!opts.force && compareVersions(release.version, from) <= 0) {
      await removeWithRetry(staging)
      return { status: "up-to-date", from, to: release.version, steps }
    }
    const to = release.version
    done("validate", `${release.name} ${to} for ${release.platform}`)

    if (opts.dryRun) {
      await removeWithRetry(staging)
      return { status: "dry-run", from, to, steps, plan: ["backup", "stop", "swap", "migrate", "start", "cleanup"] }
    }
    if (layout.kind !== "bundle") {
      throw new Error("This is a source checkout: update it with git pull and bun run build (--dry-run works here).")
    }

    const root = installRoot(layout)
    const hasDatabase = existsSync(path.join(absoluteDataDir(), "x-stats.db"))
    const backup = hasDatabase
      ? (runCli(layout.cli, ["backup", "--kind", "pre-update", "--label", from], root).backup as { path: string }).path
      : null
    done("backup", backup ?? "no database yet")

    const wasRunning = readLauncher() !== null
    const stopped = await stopLauncher()
    done("stop", stopped.wasRunning ? `stopped the running app${stopped.forced ? " (forced)" : ""}` : "the app wasn't running")

    // Windows can't rename a folder that is this process's working directory.
    process.chdir(root)
    const old = path.join(root, "app.old")
    await removeWithRetry(old)
    await renameWithRetry(layout.appDir, old)
    try {
      await renameWithRetry(staging, layout.appDir)
    } catch (err) {
      await renameWithRetry(old, layout.appDir)
      throw err
    }
    done("swap", `${layout.appDir} now holds ${to} (previous in app.old)`)

    const next = getLayout(layout.appDir)
    try {
      if (opts.simulateFailure === "migrate") throw new Error("Simulated migration failure (--simulate-failure migrate)")
      const migrated = runCli(next.cli, ["update", "migrate"], root)
      done("migrate", `${migrated.applied ?? 0} migration(s) applied`)

      if (opts.simulateFailure === "start") throw new Error("Simulated start failure (--simulate-failure start)")
      const started = runCli(next.cli, ["start", "--detach"], root, 180_000)
      done("start", `running at ${started.url} (pid ${started.pid})`)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error(`Update to ${to} failed: ${error}. Rolling back to ${from}.`)
      opts.onProgress?.(`✗ ${error}`)
      opts.onProgress?.(`Rolling back to ${from}…`)
      await stopLauncher()
      const failed = path.join(root, "app.failed")
      await removeWithRetry(failed)
      await renameWithRetry(layout.appDir, failed)
      await renameWithRetry(old, layout.appDir)
      if (backup) restoreBackup(backup)
      let restarted = ""
      if (wasRunning) {
        const r = runCli(layout.cli, ["start", "--detach"], root, 180_000)
        restarted = `; ${from} is running again at ${r.url}`
      }
      log.info(`Rolled back to ${from}${backup ? " and restored the database backup" : ""}${restarted}`)
      return { status: "rolled-back", from, to, steps, backup, error: `${error} (rolled back to ${from}${restarted})` }
    }

    const leftovers = [old, path.join(root, "app.failed")].filter((d) => existsSync(d))
    const removal = leftovers.map((d) => removeDir(d))
    const cleanup = removal.includes("scheduled") ? "the previous version is deleted once this command exits" : "removed the previous version"
    if (downloaded) rmSync(downloaded, { force: true })
    // Re-register the login item in case the new version starts differently.
    try {
      const auto = runCli(next.cli, ["autostart", "status"], root)
      if (auto.enabled) runCli(next.cli, ["autostart", "enable"], root)
    } catch (err) {
      log.warn(`Could not refresh autostart: ${err instanceof Error ? err.message : String(err)}`)
    }
    done("cleanup", cleanup)
    log.info(`Updated ${from} → ${to}`)
    return { status: "updated", from, to, steps, backup, url: readLauncher()?.url }
  } catch (err) {
    if (existsSync(staging)) await removeWithRetry(staging).catch(() => {})
    log.error(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  } finally {
    locked.lock.release()
  }
}
