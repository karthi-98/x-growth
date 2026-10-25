import { spawn, type ChildProcess } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

import { APP_NAME } from "../app"
import { appUrl, type ServerRuntime } from "./config"
import { killTree, probe, readLauncher, sleep, WORKER_LOCKED_EXIT, type LauncherState } from "./instance"
import { appVersion, type Layout } from "./layout"
import { acquireLock, isAlive } from "./lock"
import { createLogger, logFile, tailLog, type Logger } from "./log"
import { runMigrations } from "./migrate"
import { absoluteDataDir, runtimePaths } from "./paths"
import { bunPath, isWindows, nodePath } from "./platform"
import { startHidden } from "./windows"

/*
 * `xstats start`: runs the Next server and the worker as child processes,
 * restarts them when they crash, and stops them together. One launcher per
 * data folder (lock in data/run/xstats.lock). Logs go to data/logs/:
 * xstats.log (this process), server.log, worker.log.
 */

export class AlreadyRunningError extends Error {
  constructor(readonly state: LauncherState) {
    super(`${APP_NAME} is already running at ${state.url} (pid ${state.pid}).`)
  }
}

export type LauncherOptions = {
  layout: Layout
  port: number
  runtime: ServerRuntime
  /** Also print log lines to the console (foreground runs). */
  echo: boolean
}

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
const READY_TIMEOUT_MS = 90_000
const HEALTH_INTERVAL_MS = 30_000
const STOP_TIMEOUT_MS = 15_000
/** A child that ran this long before crashing starts its backoff over. */
const STABLE_MS = 60_000

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * A source checkout's .next/standalone lacks static files and public/
 * (Next leaves them to a CDN); copy them in once per build.
 */
export function prepareStandalone(layout: Layout) {
  if (!existsSync(layout.serverJs)) {
    throw new Error(`No production build found at ${layout.serverJs}. Run "bun run build" first.`)
  }
  const standalone = path.dirname(layout.serverJs)
  const buildId = readFileSync(path.join(layout.appDir, ".next", "BUILD_ID"), "utf8").trim()
  const marker = path.join(standalone, ".next", "static", ".xstats-build-id")
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === buildId) return
  const staticDir = path.join(standalone, ".next", "static")
  rmSync(staticDir, { recursive: true, force: true })
  cpSync(path.join(layout.appDir, ".next", "static"), staticDir, { recursive: true })
  const publicDir = path.join(layout.appDir, "public")
  if (existsSync(publicDir)) cpSync(publicDir, path.join(standalone, "public"), { recursive: true, force: true })
  writeFileSync(marker, buildId)
}

type Runtime = { name: "bun" | "node"; bin: string }

function resolveRuntime(preference: ServerRuntime): Runtime {
  const bun = bunPath()
  const node = nodePath()
  if (preference === "node") {
    if (!node) throw new Error('The runtime is set to "node" but Node.js was not found on PATH.')
    return { name: "node", bin: node }
  }
  if (bun) return { name: "bun", bin: bun }
  if (preference === "auto" && node) return { name: "node", bin: node }
  throw new Error("Bun was not found. Install it from https://bun.sh and try again.")
}

type Child = {
  name: "server" | "worker"
  proc: ChildProcess | null
  failures: number
  startedAt: number
  /** Answered on its port at least once since its last crash (server only). */
  wasReady: boolean
  restartTimer: ReturnType<typeof setTimeout> | null
  out: Logger
}

/** Runs until stopped; resolves with the process exit code. */
export async function runLauncher(opts: LauncherOptions): Promise<number> {
  const { layout, port } = opts
  const url = appUrl(port)
  const dataDir = absoluteDataDir()
  mkdirSync(runtimePaths.run, { recursive: true })
  const log = createLogger("xstats", { echo: opts.echo })

  const acquired = acquireLock<LauncherState>(runtimePaths.launcherLock, {
    port,
    url,
    runtime: "bun",
    appDir: layout.appDir,
    dataDir,
    version: appVersion(layout.appDir),
    ready: false,
    serverPid: null,
    workerPid: null,
  })
  if (!acquired.ok) throw new AlreadyRunningError(acquired.holder)
  const lock = acquired.lock
  try {
    unlinkSync(runtimePaths.stopRequest)
  } catch {
    // No leftover request.
  }

  log.info(`Starting ${APP_NAME} ${lock.info.version} (${layout.kind}) at ${url}`)
  log.info(`App folder: ${layout.appDir}`)
  log.info(`Data folder: ${dataDir}`)

  let runtime: Runtime
  let bun: string
  try {
    const m = await runMigrations(layout.migrations)
    log.info(m.applied ? `Applied ${m.applied} database migration(s)` : "Database schema is up to date")
    if (layout.kind === "source") prepareStandalone(layout)
    else if (!existsSync(layout.serverJs)) throw new Error(`This install is missing ${layout.serverJs}. Reinstall ${APP_NAME}.`)
    runtime = resolveRuntime(opts.runtime)
    const foundBun = bunPath()
    if (!foundBun) throw new Error("Bun was not found; the worker needs it. Install it from https://bun.sh.")
    bun = foundBun
  } catch (err) {
    log.error(`Could not start: ${message(err)}`)
    lock.release()
    return 1
  }
  lock.update({ runtime: runtime.name })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    XSTATS_PORT: String(port),
    XSTATS_DATA_DIR: dataDir,
    XSTATS_APP_DIR: layout.appDir,
    XSTATS_SUPERVISED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  }

  let stopping = false
  let resolveDone: (code: number) => void = () => {}
  const done = new Promise<number>((resolve) => (resolveDone = resolve))

  const makeChild = (name: Child["name"], out: Logger): Child => ({
    name,
    proc: null,
    failures: 0,
    startedAt: 0,
    wasReady: false,
    restartTimer: null,
    out,
  })
  const server = makeChild("server", createLogger("server", { echo: opts.echo }))
  // The worker writes worker.log itself; this only catches stray output and crash traces.
  const worker = makeChild("worker", createLogger("worker", { echo: opts.echo }))

  const pidKey = (c: Child) => (c.name === "server" ? "serverPid" : "workerPid")

  function spawnChild(c: Child) {
    if (stopping) return
    const [bin, args, cwd] =
      c.name === "server"
        ? [runtime.bin, [layout.serverEntry, layout.serverJs], path.dirname(layout.serverJs)]
        : [bun, [layout.worker], layout.appDir]
    const proc = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    c.proc = proc
    c.startedAt = Date.now()
    c.wasReady = false
    let warnedPort = false
    const onOutput = (chunk: Buffer) => {
      c.out.raw(chunk)
      if (c.name === "server" && !warnedPort && chunk.includes("EADDRINUSE")) {
        warnedPort = true
        log.error(`Port ${port} is already in use by another program. Free it, or run "xstats start --port <other port>".`)
      }
    }
    proc.stdout?.on("data", onOutput)
    proc.stderr?.on("data", onOutput)
    proc.stdin?.on("error", () => {}) // EPIPE once the child is gone.
    proc.on("error", (err) => {
      log.error(`${c.name} could not be started: ${err.message}`)
      if (proc.pid === undefined) onExit(c, proc, null, null)
    })
    proc.on("exit", (code, signal) => onExit(c, proc, code, signal))
    lock.update({ [pidKey(c)]: proc.pid ?? null } as Partial<LauncherState>)
    log.info(`${c.name} started (pid ${proc.pid ?? "?"}${c.name === "server" ? `, ${runtime.name}` : ""})`)
    if (c.name === "server") void waitUntilReady(proc)
  }

  function onExit(c: Child, proc: ChildProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (c.proc !== proc) return
    c.proc = null
    lock.update({ [pidKey(c)]: null, ...(c.name === "server" ? { ready: false } : {}) } as Partial<LauncherState>)
    if (stopping) return

    if (Date.now() - c.startedAt > STABLE_MS) c.failures = 0
    c.failures++
    let delay = BACKOFF_MS[Math.min(c.failures - 1, BACKOFF_MS.length - 1)]
    if (c.name === "worker" && code === WORKER_LOCKED_EXIT) {
      delay = 60_000
      log.warn("Another worker is already running for this data folder; checking again in 60s")
    } else {
      log.warn(`${c.name} exited (${signal ?? `code ${code}`}); restarting in ${delay / 1000}s`)
      const tail = tailLog(c.out.file, 5).join("\n")
      if (tail) log.warn(`Last ${c.name} output:\n${tail}`)
    }
    if (c.name === "server" && !c.wasReady && opts.runtime === "auto" && runtime.name === "bun" && c.failures >= 2) {
      const node = nodePath()
      if (node) {
        runtime = { name: "node", bin: node }
        lock.update({ runtime: "node" })
        log.warn("The server failed to start under Bun twice; using Node.js instead")
      }
    }
    c.restartTimer = setTimeout(() => {
      c.restartTimer = null
      spawnChild(c)
    }, delay)
  }

  async function waitUntilReady(proc: ChildProcess) {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (!stopping && server.proc === proc && Date.now() < deadline) {
      if (await probe(`${url}/favicon.ico`)) {
        if (server.proc !== proc) return
        server.wasReady = true
        server.failures = 0
        lock.update({ ready: true })
        log.info(`Ready at ${url}`)
        return
      }
      await sleep(500)
    }
    if (!stopping && server.proc === proc) {
      log.error(`The server did not answer within ${READY_TIMEOUT_MS / 1000}s; restarting it`)
      killTree(proc.pid)
    }
  }

  let missedProbes = 0
  const healthTimer = setInterval(async () => {
    const proc = server.proc
    if (stopping || !proc || !lock.info.ready) return
    if (await probe(`${url}/favicon.ico`, 10_000)) {
      missedProbes = 0
      return
    }
    if (++missedProbes >= 3 && server.proc === proc) {
      missedProbes = 0
      log.error("The server stopped answering; restarting it")
      killTree(proc.pid)
    }
  }, HEALTH_INTERVAL_MS)

  const stopTimer = setInterval(() => {
    if (stopping || !existsSync(runtimePaths.stopRequest)) return
    let target: number | null = null
    try {
      target = (JSON.parse(readFileSync(runtimePaths.stopRequest, "utf8")) as { pid?: number }).pid ?? null
    } catch {
      // Unreadable request: treat it as meant for us.
    }
    if (target && target !== process.pid && isAlive(target)) return
    try {
      unlinkSync(runtimePaths.stopRequest)
    } catch {
      // Already removed.
    }
    void shutdown("stop requested")
  }, 500)

  async function stopChild(c: Child) {
    if (c.restartTimer) clearTimeout(c.restartTimer)
    c.restartTimer = null
    const proc = c.proc
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
    const exited = new Promise<boolean>((resolve) => proc.once("exit", () => resolve(true)))
    // Closing stdin is the stop signal on every OS (see server-entry.mjs, worker/index.ts).
    proc.stdin?.end()
    if (!isWindows) proc.kill("SIGTERM")
    const stopped = await Promise.race([exited, sleep(STOP_TIMEOUT_MS).then(() => false)])
    if (!stopped) {
      log.warn(`${c.name} did not stop within ${STOP_TIMEOUT_MS / 1000}s; killing it`)
      killTree(proc.pid)
      await Promise.race([exited, sleep(5_000)])
    }
  }

  async function shutdown(reason: string, code = 0) {
    if (stopping) return
    stopping = true
    clearInterval(healthTimer)
    clearInterval(stopTimer)
    log.info(`Stopping (${reason})`)
    await Promise.all([stopChild(server), stopChild(worker)])
    lock.release()
    log.info("Stopped")
    resolveDone(code)
  }

  const signals: NodeJS.Signals[] = isWindows ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"]
  for (const sig of signals) process.on(sig, () => void shutdown(sig))
  process.on("uncaughtException", (err) => {
    log.error(`Launcher error: ${err.stack ?? err.message}`)
    void shutdown("launcher error", 1)
  })
  process.on("unhandledRejection", (err) => log.error(`Unhandled rejection in launcher: ${message(err)}`))
  // Last resort if something calls process.exit() before shutdown finished.
  process.on("exit", () => {
    for (const c of [server, worker]) if (c.proc?.pid && c.proc.exitCode === null) killTree(c.proc.pid)
    lock.release()
  })

  spawnChild(server)
  spawnChild(worker)
  return done
}

export type DetachResult = { status: "running" | "started" | "starting"; url: string; pid: number }

/**
 * Start the launcher in the background (no console window) and, unless
 * `wait` is false, return once the server answers.
 */
export async function startDetached(opts: {
  layout: Layout
  port: number
  runtime: ServerRuntime
  wait: boolean
  timeoutMs?: number
}): Promise<DetachResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000)
  const waitReady = async (pid: number, launched: boolean): Promise<DetachResult> => {
    while (Date.now() < deadline) {
      const state = readLauncher()
      if (state?.ready) return { status: launched ? "started" : "running", url: state.url, pid: state.pid }
      if (!state && !isAlive(pid)) {
        const tail = tailLog(logFile("xstats"), 12).join("\n")
        throw new Error(`${APP_NAME} stopped while starting. Last lines of ${logFile("xstats")}:\n${tail}`)
      }
      await sleep(500)
    }
    throw new Error(`${APP_NAME} did not become ready in time. See ${logFile("xstats")}.`)
  }

  const existing = readLauncher()
  if (existing) return opts.wait && !existing.ready ? waitReady(existing.pid, false) : { status: "running", url: existing.url, pid: existing.pid }

  const bun = bunPath()
  if (!bun) throw new Error("Bun was not found. Install it from https://bun.sh and try again.")
  // --data-dir carries the data folder; Start-Process (Windows) passes our environment too.
  const args = [opts.layout.cli, "start", "--port", String(opts.port), "--runtime", opts.runtime, "--data-dir", absoluteDataDir()]
  let pid: number | undefined
  if (isWindows) {
    pid = startHidden(bun, args, opts.layout.appDir)
  } else {
    const child = spawn(bun, args, { cwd: opts.layout.appDir, detached: true, stdio: "ignore" })
    child.unref()
    pid = child.pid
  }
  if (!pid) throw new Error("Could not start the background process.")
  if (!opts.wait) return { status: "starting", url: appUrl(opts.port), pid }
  return waitReady(pid, true)
}
