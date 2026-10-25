import { and, desc, inArray, ne } from "drizzle-orm"

import type { NextFetch } from "../contract/envelope"
import { db } from "../db/client"
import { syncRuns, type SyncRun } from "../db/schema"
import { readSettings, type AppSettings } from "../settings"
import { currentCoverage, nextFor, type SyncStateRow } from "./state"
import { isReminderTime, nextReminderAt, type Coverage } from "./window"

/*
 * One read of "how fresh is the data" for the top-bar chip, Settings,
 * `xstats status` and `xstats doctor`. Never pretends data is fresh
 * (docs/ARCHITECTURE.md principle 6).
 */

export type SyncHealth = "never" | "ok" | "partial" | "backfill" | "stale" | "failing"

export type SyncStatusInfo = {
  health: SyncHealth
  /** Coverage end (data complete up to here), else the latest imported run. */
  syncedAt: string | null
  /** Latest import from Grok Bot (manual file imports excluded). */
  lastRun: SyncRun | null
  /** No complete sync for longer than staleAfterHours: routines may be paused. */
  stale: boolean
  staleAfterHours: number
  failing: boolean
  nextReminderAt: string | null
  /** What a run started now should fetch (`xstats plan`, Sync now). */
  next: NextFetch
  coverage: Coverage
  state: SyncStateRow
  timeZone: string
}

/** Longest stretch between two reminders, in hours (24 when there are none). */
export function longestReminderGapHours(times: string[]): number {
  const mins = [...new Set(times.filter(isReminderTime))]
    .map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)))
    .sort((a, b) => a - b)
  if (mins.length === 0) return 24
  let longest = mins[0] + 1440 - mins.at(-1)!
  for (let i = 1; i < mins.length; i++) longest = Math.max(longest, mins[i] - mins[i - 1])
  return longest / 60
}

/** Missing two reminders in a row is normal (approvals expire); longer than that, or a day, is stale. */
export const staleAfterHours = (times: string[]) => Math.max(24, Math.ceil(2 * longestReminderGapHours(times)))

/** The plan a run started now would follow, plus the coverage behind it. */
export async function getPlan(now = new Date(), settings?: AppSettings) {
  const s = settings ?? (await readSettings())
  const { state, coverage } = await currentCoverage(s, now)
  return { settings: s, state, coverage, next: nextFor(s, state, coverage, now) }
}

export async function getSyncStatus(now = new Date(), settings?: AppSettings): Promise<SyncStatusInfo> {
  const plan = await getPlan(now, settings)
  const { state, coverage } = plan
  const s = plan.settings
  const [lastRun] = await db
    .select()
    .from(syncRuns)
    .where(ne(syncRuns.source, "file"))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)
  const [lastGood] = await db
    .select()
    .from(syncRuns)
    .where(and(ne(syncRuns.source, "file"), inArray(syncRuns.status, ["ok", "partial"])))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)

  const syncedAt = state.lastOkTo ?? lastGood?.windowTo ?? lastGood?.finishedAt ?? null
  const staleHours = staleAfterHours(s.sync.reminderTimes)
  const stale = !!syncedAt && now.getTime() - Date.parse(syncedAt) > staleHours * 3_600_000
  const failing = lastRun?.status === "failed"
  const health: SyncHealth = !syncedAt && !lastRun
    ? "never"
    : failing
      ? "failing"
      : stale
        ? "stale"
        : !coverage.live
          ? "backfill"
          : lastRun?.status === "partial"
            ? "partial"
            : "ok"

  return {
    health,
    syncedAt,
    lastRun: lastRun ?? null,
    stale,
    staleAfterHours: staleHours,
    failing,
    nextReminderAt: nextReminderAt(now, s.sync.reminderTimes, s.timeZone)?.toISOString() ?? null,
    next: plan.next,
    coverage,
    state,
    timeZone: s.timeZone,
  }
}
