import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import { paths } from "../paths"

/*
 * Inbox folders (docs/ARCHITECTURE.md section 6.1). The bot only writes to
 * inbox/; imported files move to processed/ (kept 14 days), rejected ones to
 * failed/ next to a .error.txt with the reason.
 */

export const PROCESSED_KEEP_DAYS = 14
const LOCK_STALE_MS = 10 * 60_000

/** Every folder under the data dir the app uses. */
export function ensureDataDirs(): string[] {
  const dirs = [paths.data, paths.inbox, paths.processed, paths.failed, paths.backups, paths.logs]
  for (const dir of dirs) mkdirSync(dir, { recursive: true })
  return dirs
}

const resolved = (p: string) => path.resolve(/*turbopackIgnore: true*/ p)

export function isInInbox(file: string): boolean {
  return path.dirname(resolved(file)).toLowerCase() === resolved(paths.inbox).toLowerCase()
}

/**
 * JSON files waiting in the inbox, oldest first. `minAgeMs` skips files
 * modified that recently (the bot may still be writing them).
 */
export function listInbox(opts: { minAgeMs?: number; now?: Date } = {}): string[] {
  if (!existsSync(paths.inbox)) return []
  const now = (opts.now ?? new Date()).getTime()
  return readdirSync(paths.inbox, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.toLowerCase().endsWith(".json"))
    .map((e) => {
      const file = path.join(paths.inbox, e.name)
      return { file, mtime: statSync(file).mtimeMs }
    })
    .filter((f) => !opts.minAgeMs || now - f.mtime >= opts.minAgeMs)
    .sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file))
    .map((f) => f.file)
}

/** `dir/name`, or `dir/name-1.json` etc. when taken. */
function freeName(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let candidate = path.join(dir, name)
  for (let i = 1; existsSync(candidate) || existsSync(`${candidate}.error.txt`); i++) {
    candidate = path.join(dir, `${base}-${i}${ext}`)
  }
  return candidate
}

function moveInto(file: string, dir: string): string {
  mkdirSync(dir, { recursive: true })
  const dest = freeName(dir, path.basename(file))
  renameSync(file, dest)
  // Retention counts from the move, not from when the bot wrote the file.
  const now = new Date()
  utimesSync(dest, now, now)
  return dest
}

export const moveToProcessed = (file: string) => moveInto(file, paths.processed)

export function moveToFailed(file: string, reason: string, now = new Date()): string {
  const dest = moveInto(file, paths.failed)
  writeFileSync(`${dest}.error.txt`, `${now.toISOString()}\n${reason}\n`)
  return dest
}

/** Delete processed files older than the retention. Returns how many went. */
export function pruneProcessed(now = new Date()): number {
  if (!existsSync(paths.processed)) return 0
  const cutoff = now.getTime() - PROCESSED_KEEP_DAYS * 24 * 3_600_000
  let removed = 0
  for (const e of readdirSync(paths.processed, { withFileTypes: true })) {
    if (!e.isFile()) continue
    const file = path.join(paths.processed, e.name)
    if (statSync(file).mtimeMs < cutoff) {
      unlinkSync(file)
      removed++
    }
  }
  return removed
}

/** Files in failed/ (not their .error.txt), newest first. */
export function listFailed(): { file: string; at: Date; reason: string }[] {
  if (!existsSync(paths.failed)) return []
  return readdirSync(paths.failed, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith(".error.txt"))
    .map((e) => {
      const file = path.join(paths.failed, e.name)
      const errorFile = `${file}.error.txt`
      const reason = existsSync(errorFile) ? readFileSync(errorFile, "utf8").split("\n").slice(1).join(" ").trim() : ""
      return { file, at: statSync(file).mtime, reason }
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

const lockPath = () => path.join(paths.data, "import.lock")

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

function tryLock(): boolean {
  const file = lockPath()
  try {
    const fd = openSync(file, "wx")
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    closeSync(fd)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
  }
  // Held: take it over when its owner died or it is older than any real import.
  try {
    const held = JSON.parse(readFileSync(file, "utf8")) as { pid?: number; at?: string }
    const age = Date.now() - Date.parse(held.at ?? "")
    if (!(age < LOCK_STALE_MS) || !held.pid || !processAlive(held.pid)) {
      unlinkSync(file)
      return tryLock()
    }
  } catch {
    // Unreadable lock (being written or removed): treat as held.
  }
  return false
}

/**
 * Run `fn` holding the import lock, so the worker and the CLI never import
 * at the same time. Waits up to `waitMs`; returns null when still held.
 */
export async function withImportLock<T>(fn: () => Promise<T>, opts: { waitMs?: number } = {}): Promise<T | null> {
  mkdirSync(paths.data, { recursive: true })
  const deadline = Date.now() + (opts.waitMs ?? 0)
  while (!tryLock()) {
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 250))
  }
  try {
    return await fn()
  } finally {
    try {
      unlinkSync(lockPath())
    } catch {
      // Already gone.
    }
  }
}
