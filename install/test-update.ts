/**
 * End-to-end test of an installed bundle and `xstats update`, using two
 * bundles built by install/pack.ts (same build, different versions is fine):
 *
 *   bun install/test-update.ts <old archive> <new archive> [--port 3998]
 *
 * Installs <old> into a temp folder laid out like a real install
 * (XGrowth/app + XGrowth/data), starts it, and checks that:
 *   - the app answers on 127.0.0.1 and rejects a foreign Host header
 *   - `backup` works
 *   - `update --dry-run` changes nothing
 *   - a failed migration and a failed start both roll back to <old>
 *   - a bad checksum is refused
 *   - a real update installs <new> and restarts it
 * Both archives need SHA256SUMS next to them (pack.ts writes it).
 * CI runs it on every platform; it exits 1 if any check fails.
 */
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

import { extractArchive } from "../lib/runtime/archive"

const [oldArchive, newArchive] = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => path.resolve(a))
const portArg = process.argv.indexOf("--port")
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 3998
if (!oldArchive || !newArchive) {
  console.error("usage: bun install/test-update.ts <old archive> <new archive> [--port 3998]")
  process.exit(2)
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "xgrowth-test-"))
const root = path.join(tmp, "XGrowth")
const app = path.join(root, "app")
const cli = path.join(app, "xstats.js")
let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
}

/** Run the installed CLI with --json; returns its exit code and parsed result. */
function xs(...args: string[]) {
  const env = { ...process.env }
  delete env.XSTATS_DATA_DIR // the bundle finds XGrowth/data by itself
  const r = spawnSync(process.execPath, [cli, ...args, "--json"], { cwd: tmp, env, encoding: "utf8", timeout: 240_000 })
  const last = (r.stdout ?? "").trim().split(/\r?\n/).pop() ?? ""
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(last)
  } catch {
    json = { raw: `${r.stdout}\n${r.stderr}`.trim().slice(-800) }
  }
  return { code: r.status, json }
}

/** GET with an explicit Host header (fetch won't let us set it). */
function get(pathname: string, host = `127.0.0.1:${port}`): Promise<number> {
  return new Promise((resolve) => {
    // agent: false — a pooled keep-alive socket would still point at the server process an update just stopped.
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers: { host }, agent: false }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on("error", () => resolve(0))
    req.setTimeout(30_000, () => req.destroy())
    req.end()
  })
}

const version = () => (JSON.parse(readFileSync(path.join(app, "release.json"), "utf8")) as { version: string }).version

/** Copy an archive and a SHA256SUMS line for it into its own folder. */
function stageArchive(archive: string, dir: string, hash?: string) {
  mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, path.basename(archive))
  copyFileSync(archive, dest)
  const sums = readFileSync(path.join(path.dirname(archive), "SHA256SUMS"), "utf8")
  const line = sums.split(/\r?\n/).find((l) => l.endsWith(` ${path.basename(archive)}`))
  if (!line) throw new Error(`SHA256SUMS has no line for ${path.basename(archive)}`)
  writeFileSync(path.join(dir, "SHA256SUMS"), hash ? `${hash}  ${path.basename(archive)}\n` : `${line}\n`)
  return dest
}

try {
  console.log(`Test install in ${root}`)
  extractArchive(oldArchive, app)
  const from = version()
  const next = stageArchive(newArchive, path.join(tmp, "new"))

  const started = xs("start", "--detach", "--port", String(port))
  check("start --detach", started.json.status === "started", JSON.stringify(started.json))
  check("data folder sits next to app/", existsSync(path.join(root, "data", "x-stats.db")))
  // Every page, a route handler and a 404: a file missing from the bundle's trace shows up here.
  for (const [route, expected] of [
    ["/", 200], ["/posts", 200], ["/insights", 200], ["/compose", 200], ["/queue", 200],
    ["/replies", 200], ["/settings", 200], ["/setup", 200], ["/setup?step=first-sync", 200],
    ["/favicon.ico", 200], ["/no-such-page", 404],
  ] as const) {
    const status = await get(route)
    check(`GET ${route}`, status === expected, `HTTP ${status}`)
  }
  const serverLog = path.join(root, "data", "logs", "server.log")
  const missing = existsSync(serverLog) ? readFileSync(serverLog, "utf8").match(/Cannot find module[^\n]*/g) ?? [] : []
  check("server found every module it loaded", missing.length === 0, missing.slice(0, 3).join(" | "))
  check("foreign Host header is rejected", (await get("/", `evil.example:${port}`)) === 421)

  const backup = xs("backup")
  check("backup", backup.json.status === "ok", String((backup.json.backup as { name?: string } | undefined)?.name ?? JSON.stringify(backup.json)))

  const pid = (xs("start", "--detach").json.pid as number) ?? 0
  const dry = xs("update", "--dry-run", "--from-file", next)
  check("update --dry-run", dry.json.status === "dry-run" && version() === from, `${dry.json.from} → ${dry.json.to}`)
  check("dry run left the app running", xs("start", "--detach").json.pid === pid && (await get("/")) === 200)

  for (const step of ["migrate", "start"]) {
    const r = xs("update", "--from-file", next, "--simulate-failure", step)
    const data = r.json.data as { status?: string; backup?: string } | undefined
    check(`failed ${step} rolls back`, r.code === 1 && data?.status === "rolled-back" && version() === from, String(r.json.error ?? JSON.stringify(r.json)))
    const status = await get("/")
    check(`old version answers after the ${step} rollback`, status === 200, `HTTP ${status}`)
    check(`database backup was taken before the ${step} attempt`, !!data?.backup && existsSync(data.backup))
  }

  const bad = stageArchive(newArchive, path.join(tmp, "bad"), "0".repeat(64))
  const refused = xs("update", "--from-file", bad)
  check("bad checksum is refused", refused.code === 1 && /Checksum mismatch/.test(String(refused.json.error)) && version() === from)

  const updated = xs("update", "--from-file", next)
  const to = version()
  check("update installs the new bundle", updated.json.status === "updated" && to !== from, `${from} → ${to}`)
  const after = await get("/")
  check("new version answers", after === 200, `HTTP ${after}`)
  // On Windows the old folder is deleted by a helper once the update process has exited.
  const leftovers = () => ["app.old", "app.new", "app.failed"].filter((d) => existsSync(path.join(root, d)))
  for (let i = 0; i < 40 && leftovers().length; i++) await Bun.sleep(500)
  check("previous version was cleaned up", leftovers().length === 0, leftovers().join(", "))
} catch (err) {
  check("test run", false, err instanceof Error ? (err.stack ?? err.message) : String(err))
} finally {
  if (failures) {
    for (const name of ["xstats", "server", "worker", "update"]) {
      const file = path.join(root, "data", "logs", `${name}.log`)
      if (!existsSync(file)) continue
      console.log(`\n--- last lines of ${name}.log ---`)
      console.log(readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-25).join("\n"))
    }
  }
  if (existsSync(cli)) xs("stop")
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(tmp, { recursive: true, force: true })
      break
    } catch {
      await Bun.sleep(500)
    }
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed")
process.exit(failures ? 1 : 0)
