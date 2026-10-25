import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs"
import path from "node:path"

import { paths } from "../paths"
import { runtimePaths } from "./paths"

/*
 * Consistent copies of the database in data/backups, made with
 * `VACUUM INTO` (safe while the app is writing). Names carry the UTC time:
 *   x-stats-20261024T083000Z.db                    daily (worker) — keep 7
 *   x-stats-20261024T083000Z-manual.db             `xstats backup` — counts toward the 7
 *   x-stats-20261024T083000Z-pre-update-0.2.0.db   before `xstats update` — keep 3
 * Files with other names (e.g. hand-made copies) are never touched.
 */

export const KEEP_BACKUPS = 7
export const KEEP_PRE_UPDATE = 3

export type BackupKind = "daily" | "manual" | "pre-update"

export type BackupFile = {
  name: string
  path: string
  kind: BackupKind
  /** Version being updated from, for pre-update backups. */
  label: string | null
  size: number
  createdAt: string
}

const NAME = /^x-stats-(\d{8}T\d{6}Z)(?:-(manual|pre-update)(?:-([\w.+-]+))?)?\.db$/

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")

function parseStamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : stamp
}

const backupDir = () => path.join(/*turbopackIgnore: true*/ runtimePaths.backups)

/** Backups we made, newest first. */
export function listBackups(): BackupFile[] {
  const dir = backupDir()
  if (!existsSync(dir)) return []
  const out: BackupFile[] = []
  for (const name of readdirSync(dir)) {
    const m = NAME.exec(name)
    if (!m) continue
    const file = path.join(dir, name)
    out.push({
      name,
      path: file,
      kind: (m[2] as BackupKind | undefined) ?? "daily",
      label: m[3] ?? null,
      size: statSync(file).size,
      createdAt: parseStamp(m[1]),
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Newest daily or manual backup (pre-update copies don't count toward the daily schedule). */
export const latestRegularBackup = () => listBackups().find((b) => b.kind !== "pre-update") ?? null

/** Delete regular backups beyond the newest 7 and pre-update ones beyond the newest 3. */
export function pruneBackups(): string[] {
  const all = listBackups()
  const drop = [
    ...all.filter((b) => b.kind !== "pre-update").slice(KEEP_BACKUPS),
    ...all.filter((b) => b.kind === "pre-update").slice(KEEP_PRE_UPDATE),
  ]
  const removed: string[] = []
  for (const b of drop) {
    try {
      rmSync(b.path, { force: true })
      removed.push(b.name)
    } catch {
      // Open in another program (Windows); try again next time.
    }
  }
  return removed
}

/**
 * Structural check of a fresh copy: SQLite's header, and a page count that
 * matches the file size. (Opening it with a second libSQL client would keep
 * the file locked on Windows until the process exits.)
 */
function checkCopy(file: string) {
  const header = Buffer.alloc(100)
  const fd = openSync(file, "r")
  try {
    readSync(fd, header, 0, 100, 0)
  } finally {
    closeSync(fd)
  }
  if (header.toString("latin1", 0, 16) !== "SQLite format 3\u0000") throw new Error("The backup copy is not a SQLite database.")
  const rawPageSize = header.readUInt16BE(16)
  const pageSize = rawPageSize === 1 ? 65_536 : rawPageSize
  const pages = header.readUInt32BE(28)
  if (pages === 0 || pages * pageSize !== statSync(file).size) throw new Error("The backup copy is incomplete.")
}

/** Copy the live database into data/backups, check the copy, then prune old ones. */
export async function createBackup(kind: BackupKind = "manual", label?: string): Promise<BackupFile & { pruned: string[] }> {
  if (!existsSync(paths.database)) throw new Error(`There is no database to back up yet (${paths.database}).`)
  const dir = backupDir()
  mkdirSync(dir, { recursive: true })
  const suffix = kind === "daily" ? "" : kind === "manual" ? "-manual" : `-pre-update${label ? `-${label.replace(/[^\w.+-]/g, "_")}` : ""}`
  const name = `x-stats-${stampOf(new Date())}${suffix}.db`
  const final = path.join(dir, name)
  const partial = `${final}.partial`
  rmSync(partial, { force: true })

  const { db } = await import("../db/client")
  try {
    await db.$client.execute({ sql: "VACUUM INTO ?", args: [path.resolve(partial)] })
    checkCopy(partial)
    renameSync(partial, final)
  } catch (err) {
    rmSync(partial, { force: true })
    throw err
  }
  const pruned = pruneBackups()
  const made = listBackups().find((b) => b.name === name)
  if (!made) throw new Error(`The backup ${name} disappeared right after it was written.`)
  return { ...made, pruned }
}

/**
 * Put a backup back as the live database. The app (server and worker) must
 * be stopped, and this process must never have opened the database: libSQL
 * keeps the file locked on Windows even after close().
 */
export function restoreBackup(file: string) {
  const db = path.resolve(paths.database)
  const incoming = `${db}.restore`
  copyFileSync(file, incoming)
  for (const extra of ["-wal", "-shm", "-journal"]) {
    if (existsSync(db + extra)) unlinkSync(db + extra)
  }
  renameSync(incoming, db)
}
