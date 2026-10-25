import { desc } from "drizzle-orm"
import { connection } from "next/server"

import { db } from "../db/client"
import { syncRuns } from "../db/schema"
import { hasAiKey, hasXKeys, readSecrets } from "../secrets"
import { readSettings } from "../settings"
import { autostartStatus, type AutostartStatus } from "./autostart"
import { listBackups, type BackupFile } from "./backup"
import { readLauncher, readWorkerStatus, type LauncherState, type WorkerStatus } from "./instance"
import { appVersion, getLayout, readRelease } from "./layout"
import { isAlive } from "./lock"
import { absoluteDataDir } from "./paths"
import { platformId } from "./platform"

/*
 * What the /setup wizard and Settings → App show. Server components only
 * (reads files and the database per request). Keys never leave this module:
 * only "is it saved" booleans do.
 */

export type SyncRunSummary = {
  id: string
  type: string
  status: string
  source: string
  postsReceived: number
  postsNew: number
  postsUpdated: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export type SetupStatus = {
  handle: string | null
  timeZone: string
  /** Days the first import covers (settings.sync.backfillDays). */
  backfillDays: number
  hasXKeys: boolean
  hasAiKey: boolean
  latestRun: SyncRunSummary | null
}

export async function getSetupStatus(): Promise<SetupStatus> {
  await connection()
  const secrets = readSecrets()
  const [settings, runs] = await Promise.all([
    readSettings(),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
  ])
  const run = runs[0]
  return {
    handle: settings.handle,
    timeZone: settings.timeZone,
    backfillDays: settings.sync.backfillDays,
    hasXKeys: hasXKeys(secrets),
    hasAiKey: hasAiKey(secrets),
    latestRun: run
      ? {
          id: run.id,
          type: run.type,
          status: run.status,
          source: run.source,
          postsReceived: run.postsReceived,
          postsNew: run.postsNew,
          postsUpdated: run.postsUpdated,
          error: run.error,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        }
      : null,
  }
}

export type AppInfo = {
  version: string
  kind: "bundle" | "source"
  platform: string | null
  /** What runs this web server, e.g. "Bun 1.4.0". */
  serverRuntime: string
  appDir: string
  dataDir: string
  /** Null when the app runs some other way (e.g. `bun dev`). */
  launcher: LauncherState | null
  worker: (WorkerStatus & { alive: boolean }) | null
  autostart: AutostartStatus
  backups: BackupFile[]
}

export async function getAppInfo(): Promise<AppInfo> {
  await connection()
  const layout = getLayout()
  const worker = readWorkerStatus()
  return {
    version: appVersion(layout.appDir),
    kind: layout.kind,
    platform: readRelease(layout.appDir)?.platform ?? platformId(),
    serverRuntime: process.versions.bun ? `Bun ${process.versions.bun}` : `Node.js ${process.versions.node}`,
    appDir: layout.appDir,
    dataDir: absoluteDataDir(),
    launcher: readLauncher(),
    worker: worker ? { ...worker, alive: !worker.stoppedAt && isAlive(worker.pid) } : null,
    autostart: autostartStatus(),
    backups: listBackups(),
  }
}
