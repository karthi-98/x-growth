import { and, desc, eq, isNotNull } from "drizzle-orm"

import { db } from "../db/client"
import { syncRuns, syncState } from "../db/schema"
import type { Queryable } from "../import/db"
import type { AppSettings } from "../settings"
import { computeCoverage, nextReminderAt, planNext, type Coverage, type Interval } from "./window"

/*
 * sync_state (one row, id = 1) and the coverage history in sync_runs. Only
 * post files store a window on their sync_runs row; mentions, account and
 * inspiration files leave it null, so the windows below are post coverage.
 */

export type SyncStateRow = {
  lastOkTo: string | null
  lastFullRefreshDay: string | null
  backfillDoneAt: string | null
  lastMentionId: string | null
}

const STATE_ID = 1

export async function readSyncState(q: Queryable = db): Promise<SyncStateRow> {
  const [row] = await q.select().from(syncState).where(eq(syncState.id, STATE_ID))
  return {
    lastOkTo: row?.lastOkTo ?? null,
    lastFullRefreshDay: row?.lastFullRefreshDay ?? null,
    backfillDoneAt: row?.backfillDoneAt ?? null,
    lastMentionId: row?.lastMentionId ?? null,
  }
}

export async function writeSyncState(patch: Partial<SyncStateRow>, q: Queryable = db): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await q
    .insert(syncState)
    .values({ id: STATE_ID, ...patch })
    .onConflictDoUpdate({ target: syncState.id, set: patch })
}

/** Complete post windows that imported cleanly: the coverage history. */
export async function coverageWindows(q: Queryable = db): Promise<Interval[]> {
  const rows = await q
    .select({ from: syncRuns.windowFrom, to: syncRuns.windowTo })
    .from(syncRuns)
    .where(
      and(eq(syncRuns.complete, true), eq(syncRuns.status, "ok"), isNotNull(syncRuns.windowFrom), isNotNull(syncRuns.windowTo))
    )
  return rows.map((r) => ({ from: r.from!, to: r.to! }))
}

export async function currentCoverage(settings: AppSettings, now: Date, q: Queryable = db) {
  const state = await readSyncState(q)
  const coverage = computeCoverage({
    lastOkTo: state.lastOkTo,
    windows: await coverageWindows(q),
    now,
    backfillDays: settings.sync.backfillDays,
  })
  return { state, coverage }
}

/** The `next` block for a given run time (see planNext). */
export function nextFor(settings: AppSettings, state: SyncStateRow, coverage: Coverage, runAt: Date) {
  return planNext({
    coverage,
    lastFullRefreshDay: state.lastFullRefreshDay,
    lastMentionId: state.lastMentionId,
    sync: settings.sync,
    timeZone: settings.timeZone,
    runAt,
  })
}

/** When the bot will next use an import's `next`: the next reminder, or now when none are set. */
export const nextRunAt = (settings: AppSettings, now: Date) =>
  nextReminderAt(now, settings.sync.reminderTimes, settings.timeZone) ?? now

/** Most recent sync_runs rows, newest first. */
export async function recentRuns(limit = 20, q: Queryable = db) {
  return q.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit)
}
