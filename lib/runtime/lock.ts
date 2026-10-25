import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/*
 * Single-instance locks: a JSON file created with O_EXCL that names the
 * owning pid. A lock is stale when its pid is gone or when it was taken
 * before the computer last booted (pids are reused after a reboot, and a
 * hard shutdown never removes the file).
 */

export type LockInfo = { pid: number; startedAt: string }

export type Lock<T extends LockInfo> = {
  info: T
  /** Rewrite the lock file with more state (e.g. ready, child pids). */
  update(patch: Partial<T>): void
  /** Remove the file if this process still owns it. */
  release(): void
}

export type AcquireResult<T extends LockInfo> = { ok: true; lock: Lock<T> } | { ok: false; holder: T }

/** True if a process with this pid exists (EPERM means it exists but isn't ours). */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

const bootTime = () => Date.now() - os.uptime() * 1000

function readRaw<T extends LockInfo>(file: string): T | null {
  try {
    const info = JSON.parse(readFileSync(file, "utf8")) as T
    return typeof info?.pid === "number" ? info : null
  } catch {
    return null
  }
}

/** The lock holder, or null when the lock is free or stale. */
export function readLock<T extends LockInfo>(file: string): T | null {
  const info = readRaw<T>(file)
  if (!info) return null
  const started = Date.parse(info.startedAt)
  // Allow a minute of clock slack around boot.
  if (Number.isFinite(started) && started < bootTime() - 60_000) return null
  return isAlive(info.pid) ? info : null
}

function removeStale(file: string) {
  // Rename first so two processes clearing the same stale lock can't both win.
  const aside = `${file}.stale-${process.pid}`
  try {
    renameSync(file, aside)
    unlinkSync(aside)
  } catch {
    // Someone else cleared it.
  }
}

export function acquireLock<T extends LockInfo>(file: string, extra: Omit<T, keyof LockInfo>): AcquireResult<T> {
  mkdirSync(path.dirname(file), { recursive: true })
  const info = { ...extra, pid: process.pid, startedAt: new Date().toISOString() } as T
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, JSON.stringify(info), { flag: "wx" })
      return { ok: true, lock: makeLock(file, info) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      const holder = readLock<T>(file)
      if (holder && holder.pid !== process.pid) return { ok: false, holder }
      removeStale(file)
    }
  }
  const holder = readRaw<T>(file)
  if (holder) return { ok: false, holder }
  throw new Error(`Could not take the lock ${file}`)
}

function makeLock<T extends LockInfo>(file: string, info: T): Lock<T> {
  const lock: Lock<T> = {
    info,
    update(patch) {
      Object.assign(lock.info, patch)
      if (readRaw<T>(file)?.pid === process.pid) writeFileSync(file, JSON.stringify(lock.info))
    },
    release() {
      if (readRaw<T>(file)?.pid !== process.pid) return
      try {
        unlinkSync(file)
      } catch {
        // Already gone.
      }
    },
  }
  return lock
}
