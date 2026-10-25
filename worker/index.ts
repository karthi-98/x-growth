/**
 * Long-running local worker (docs/ARCHITECTURE.md section 3): runs periodic
 * jobs while the computer is on. Started by `xstats start` next to the web
 * server; run alone with `bun run worker`.
 *
 * Jobs live in worker/jobs/<name>.ts, one owner per file (docs/WORKSTREAMS.md).
 *
 * - One worker per data folder (data/run/worker.lock).
 * - Logs to data/logs/worker.log (rotated), and to the console in a terminal.
 * - A failing job backs off and never stops the others. Each job's last run
 *   and error are in data/run/worker-status.json (shown in Settings → App).
 * - Stops cleanly on SIGINT/SIGTERM, or when the launcher closes our stdin.
 */
import { mkdirSync, writeFileSync } from "node:fs"

import { paths } from "../lib/paths"
import { sleep, WORKER_LOCKED_EXIT, type JobStatus, type WorkerStatus } from "../lib/runtime/instance"
import { acquireLock, type LockInfo } from "../lib/runtime/lock"
import { createLogger } from "../lib/runtime/log"
import { runtimePaths } from "../lib/runtime/paths"
import type { Job } from "./types"

// Job modules open the database as they load; it needs its folder first.
mkdirSync(paths.data, { recursive: true })
mkdirSync(runtimePaths.run, { recursive: true })

const supervised = process.env.XSTATS_SUPERVISED === "1"
const log = createLogger("worker", { echo: process.stdout.isTTY === true })
const describe = (err: unknown) => (err instanceof Error ? (err.stack ?? err.message) : String(err))

const acquired = acquireLock<LockInfo>(runtimePaths.workerLock, {})
if (!acquired.ok) {
  log.warn(`Another worker is already running for this data folder (pid ${acquired.holder.pid}); exiting`)
  process.exit(WORKER_LOCKED_EXIT)
}
const lock = acquired.lock

/** Longest wait between retries of a failing job (or its interval, if longer). */
const MAX_BACKOFF_MS = 15 * 60_000
/** Log a warning when one run takes longer than this. */
const SLOW_RUN_MS = 10 * 60_000

const loaders: [string, () => Promise<{ job: Job }>][] = [
  ["inbox", () => import("./jobs/inbox")],
  ["publish", () => import("./jobs/publish")],
  ["backup", () => import("./jobs/backup")],
]

const status: WorkerStatus = { pid: process.pid, startedAt: new Date().toISOString(), stoppedAt: null, jobs: {} }
const saveStatus = () => {
  try {
    writeFileSync(runtimePaths.workerStatus, JSON.stringify(status, null, 2))
  } catch {
    // Status is informational.
  }
}

const controller = new AbortController()
const inFlight = new Set<Promise<void>>()
const now = () => new Date().toISOString()

function schedule(job: Job) {
  const s: JobStatus = {
    intervalMs: job.intervalMs,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastOkAt: null,
    lastError: null,
    failures: 0,
    nextRunAt: null,
  }
  status.jobs[job.name] = s
  let timer: ReturnType<typeof setTimeout> | undefined

  const runOnce = async () => {
    s.running = true
    s.lastStartedAt = now()
    saveStatus()
    const slow = setTimeout(() => log.warn(`${job.name}: still running after ${SLOW_RUN_MS / 60_000} min`), SLOW_RUN_MS)
    try {
      await job.run({ signal: controller.signal, log: (message) => log.info(`${job.name}: ${message}`) })
      s.failures = 0
      s.lastOkAt = now()
      s.lastError = null
    } catch (err) {
      s.failures++
      s.lastError = err instanceof Error ? err.message : String(err)
      log.error(`${job.name} failed (${s.failures} in a row): ${describe(err)}`)
    } finally {
      clearTimeout(slow)
      s.running = false
      s.lastFinishedAt = now()
    }
  }

  const tick = async () => {
    if (controller.signal.aborted) return
    const run = runOnce()
    inFlight.add(run)
    await run
    inFlight.delete(run)
    if (controller.signal.aborted) return saveStatus()
    const delay = s.failures
      ? Math.min(job.intervalMs * 2 ** s.failures, Math.max(job.intervalMs, MAX_BACKOFF_MS))
      : job.intervalMs
    s.nextRunAt = new Date(Date.now() + delay).toISOString()
    saveStatus()
    timer = setTimeout(tick, delay)
  }

  const first = job.runOnStart ? 0 : job.intervalMs
  s.nextRunAt = new Date(Date.now() + first).toISOString()
  timer = setTimeout(tick, first)
  controller.signal.addEventListener("abort", () => clearTimeout(timer))
}

let stopping = false
async function stop(reason: string, code = 0) {
  if (stopping) return
  stopping = true
  log.info(`Stopping (${reason})`)
  controller.abort()
  // Let running jobs see the abort signal and finish.
  await Promise.race([Promise.allSettled([...inFlight]), sleep(15_000)])
  status.stoppedAt = now()
  saveStatus()
  lock.release()
  process.exit(code)
}

process.on("SIGINT", () => void stop("SIGINT"))
process.on("SIGTERM", () => void stop("SIGTERM"))
if (supervised) {
  // The launcher closes this pipe to stop us, and it closes by itself if the launcher dies.
  process.stdin.on("end", () => void stop("launcher closed the pipe"))
  process.stdin.on("close", () => void stop("launcher closed the pipe"))
  process.stdin.on("error", () => void stop("launcher pipe error"))
  process.stdin.resume()
}
process.on("uncaughtException", (err) => {
  log.error(`Uncaught error: ${describe(err)}`)
  void stop("uncaught error", 1)
})
process.on("unhandledRejection", (err) => log.error(`Unhandled rejection: ${describe(err)}`))

const jobs: Job[] = []
for (const [name, load] of loaders) {
  try {
    jobs.push((await load()).job)
  } catch (err) {
    log.error(`Could not load the ${name} job; the others still run: ${describe(err)}`)
  }
}
for (const job of jobs) schedule(job)
saveStatus()
log.info(`Started (pid ${process.pid}) with ${jobs.length} jobs: ${jobs.map((j) => j.name).join(", ")}`)
