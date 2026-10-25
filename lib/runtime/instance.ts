import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

import { isAlive, readLock, type LockInfo } from "./lock"
import { runtimePaths } from "./paths"
import { bunPath, isWindows } from "./platform"
import { startHidden } from "./windows"

/*
 * The running app as seen from outside: `xstats start` writes its state into
 * its lock file, and other commands (stop, update, uninstall, the Settings
 * page) read it. Stopping works through a request file the launcher polls,
 * because Windows has no SIGTERM between processes.
 */

export type LauncherState = LockInfo & {
  port: number
  url: string
  /** What runs the Next server. */
  runtime: "bun" | "node"
  appDir: string
  dataDir: string
  version: string
  /** True once the server answered on its port. */
  ready: boolean
  serverPid: number | null
  workerPid: number | null
}

/** Worker exit code for "another worker already holds the lock" (the launcher waits longer before retrying). */
export const WORKER_LOCKED_EXIT = 3

/** One job's state in data/run/worker-status.json. */
export type JobStatus = {
  intervalMs: number
  running: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastOkAt: string | null
  lastError: string | null
  /** Failed runs in a row. */
  failures: number
  nextRunAt: string | null
}

export type WorkerStatus = { pid: number; startedAt: string; stoppedAt: string | null; jobs: Record<string, JobStatus> }

/** The worker's last written status, or null if it never ran here. */
export function readWorkerStatus(): WorkerStatus | null {
  try {
    return JSON.parse(readFileSync(runtimePaths.workerStatus, "utf8")) as WorkerStatus
  } catch {
    return null
  }
}

/** The running launcher's state, or null when the app isn't running. */
export const readLauncher = () => readLock<LauncherState>(runtimePaths.launcherLock)

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Kill a process and its children right away (last resort). */
export function killTree(pid: number | null | undefined) {
  if (!pid || !isAlive(pid)) return
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    return
  }
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // Already gone.
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await sleep(200)
  }
  return !isAlive(pid)
}

export type StopResult = { wasRunning: boolean; forced: boolean; pid: number | null }

/**
 * Ask the running launcher to stop and wait for it. After `timeoutMs` the
 * launcher, server and worker are killed.
 */
export async function stopLauncher(timeoutMs = 30_000): Promise<StopResult> {
  const state = readLauncher()
  if (!state) return { wasRunning: false, forced: false, pid: null }

  mkdirSync(runtimePaths.run, { recursive: true })
  writeFileSync(runtimePaths.stopRequest, JSON.stringify({ pid: state.pid, at: new Date().toISOString() }))
  let forced = false
  if (!(await waitForExit(state.pid, timeoutMs))) {
    forced = true
    for (const pid of [state.pid, state.serverPid, state.workerPid]) killTree(pid)
  }
  // The launcher stops its children before it exits; give stragglers a moment.
  for (const pid of [state.serverPid, state.workerPid]) {
    if (pid && !(await waitForExit(pid, 5_000))) {
      forced = true
      killTree(pid)
    }
  }
  for (const file of [runtimePaths.stopRequest]) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // Best effort.
    }
  }
  return { wasRunning: true, forced, pid: state.pid }
}

/**
 * Delete a folder now, or, if Windows refuses because this process still has
 * a file in it mapped (the libSQL native binary is loaded by every CLI run),
 * from a background process once this one has exited.
 */
export function removeDir(dir: string): "removed" | "scheduled" {
  try {
    rmSync(dir, { recursive: true, force: true })
    return "removed"
  } catch (err) {
    const bun = bunPath()
    if (!isWindows || !bun) throw err
    const script = [
      `const fs = require("fs"); const pid = ${process.pid}; const dir = ${JSON.stringify(dir)}`,
      "const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }",
      "for (let i = 0; i < 600 && alive(); i++) await Bun.sleep(100)",
      "for (let i = 0; i < 30; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break } catch { await Bun.sleep(1000) } }",
    ].join("; ")
    startHidden(bun, ["-e", script], path.dirname(dir))
    return "scheduled"
  }
}

/** True once something answers HTTP at `url` (any status). */
export async function probe(url: string, timeoutMs = 2_000): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" })
    return true
  } catch {
    return false
  }
}
