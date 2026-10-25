import type { NextFetch, RunType } from "../contract/envelope"
import { addDays, dateKeyIn, timeZoneOffsetMinutes } from "../dates"
import type { SyncSettings } from "../settings"

/*
 * Sync window rules (docs/ARCHITECTURE.md section 5). Pure functions: no DB,
 * no clock, so the import, `xstats plan`, the UI and tests share them.
 *
 * Coverage is the union of complete post windows from sync_runs. The live
 * coverage is the contiguous stretch that sync_state.last_ok_to sits in (or,
 * with no live coverage, the stretch that reaches back to the backfill start).
 * last_ok_to only moves forward over windows that touch it, so a detached
 * window leaves a gap until a catch-up fills it, and then counts too.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Catch-up windows reach back at most this far; older coverage is dropped and a backfill runs. */
export const MAX_CATCH_UP_DAYS = 90
/** Each run starts this long before last_ok_to, so neighbouring windows overlap. */
export const OVERLAP_MS = HOUR_MS
/** The bot fetches some time after the plan was made; a backfill still counts within this slack. */
const BACKFILL_SLACK_MS = DAY_MS

export type Interval = { from: string; to: string }

const ms = (iso: string) => Date.parse(iso)
const iso = (t: number) => new Date(t).toISOString()

/** Sorted, non-overlapping union; windows that touch (from <= previous to) merge. */
export function mergeIntervals(windows: Interval[]): Interval[] {
  const sorted = windows
    .map((w) => ({ from: ms(w.from), to: ms(w.to) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.from <= w.to)
    .sort((a, b) => a.from - b.from)
  const out: { from: number; to: number }[] = []
  for (const w of sorted) {
    const last = out.at(-1)
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to)
    else out.push({ ...w })
  }
  return out.map((i) => ({ from: iso(i.from), to: iso(i.to) }))
}

export type Coverage = {
  /** False when there is no coverage within the last 90 days: the next run is a backfill. */
  live: boolean
  /** End of live coverage; when not live, the stored value is kept for display. */
  lastOkTo: string | null
  /** Start of live coverage. */
  since: string | null
  /** True when live coverage was just (re)established from none, i.e. a backfill finished. */
  established: boolean
  /** An uncovered window the bot should fetch now (catch-up), or null. */
  gap: Interval | null
}

export function computeCoverage(input: {
  lastOkTo: string | null
  /** Complete post windows (sync_runs with status ok), including the ones just imported. */
  windows: Interval[]
  now: Date
  backfillDays: number
}): Coverage {
  const now = input.now.getTime()
  const floor = now - MAX_CATCH_UP_DAYS * DAY_MS
  const backfillStart = now - input.backfillDays * DAY_MS
  const merged = mergeIntervals(input.windows)
  const prev = input.lastOkTo ? ms(input.lastOkTo) : null

  let main: Interval | null = null
  let established = false
  if (prev !== null && prev >= floor) {
    main = merged.find((i) => ms(i.from) <= prev && prev <= ms(i.to)) ?? {
      from: input.lastOkTo!,
      to: input.lastOkTo!,
    }
  } else {
    // No live coverage: only a stretch that reaches back to the backfill start counts.
    const reach = backfillStart + BACKFILL_SLACK_MS
    main = merged.findLast((i) => ms(i.from) <= reach && ms(i.to) >= floor) ?? null
    established = main !== null
  }

  let gap: Interval | null = null
  if (main) {
    const end = ms(main.to)
    const detached = merged.find((i) => ms(i.from) > end)
    if (detached) gap = { from: iso(Math.max(end - OVERLAP_MS, floor)), to: detached.from }
  } else {
    // Part of a backfill (or a refresh before it) arrived: the rest of the backfill is the gap.
    const latest = merged.at(-1)
    if (latest && ms(latest.to) >= floor && ms(latest.from) > backfillStart) {
      gap = { from: iso(backfillStart), to: latest.from }
    }
  }

  return {
    live: main !== null,
    lastOkTo: main ? main.to : input.lastOkTo,
    since: main ? main.from : null,
    established,
    gap,
  }
}

/** True when the live coverage reaches back over the whole backfill window. */
export function coversBackfill(coverage: Pick<Coverage, "live" | "since">, now: Date, backfillDays: number) {
  if (!coverage.live || !coverage.since) return false
  return ms(coverage.since) <= now.getTime() - backfillDays * DAY_MS + BACKFILL_SLACK_MS
}

/** A complete window long enough to count as the day's full refresh. */
export function isFullRefresh(window: Interval, fullRefreshDays: number) {
  const span = ms(window.to) - ms(window.from)
  const full = fullRefreshDays * DAY_MS
  return span >= full - Math.min(DAY_MS, full / 4)
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** True for "HH:mm" (24-hour). */
export const isReminderTime = (t: string) => TIME_RE.test(t)

/** UTC instant of local time `time` ("HH:mm") on day `key` in `timeZone`. Re-checks the offset for DST. */
export function zonedTimeUtc(key: string, time: string, timeZone: string): Date {
  const naive = Date.parse(`${key}T${time}:00Z`)
  let instant = naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000
  instant = naive - timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000
  return new Date(instant)
}

/** The first reminder strictly after `now`, or null when none are set. */
export function nextReminderAt(now: Date, times: string[], timeZone: string): Date | null {
  const valid = [...new Set(times.filter(isReminderTime))].sort()
  if (valid.length === 0) return null
  const today = dateKeyIn(now, timeZone)
  for (const key of [today, addDays(today, 1), addDays(today, 2)]) {
    for (const t of valid) {
      const at = zonedTimeUtc(key, t, timeZone)
      if (at.getTime() > now.getTime()) return at
    }
  }
  return null
}

/**
 * What the next run should fetch (section 5). `runAt` is when the bot will
 * use the plan: the next reminder for an import's `next`, now for
 * `xstats plan`. The window ends at fetch time.
 */
export function planNext(input: {
  coverage: Pick<Coverage, "live" | "lastOkTo">
  lastFullRefreshDay: string | null
  lastMentionId: string | null
  sync: Pick<SyncSettings, "backfillDays" | "fullRefreshDays" | "lightRefreshHours" | "refreshReplies">
  timeZone: string
  runAt: Date
}): NextFetch {
  const { coverage, sync } = input
  const at = input.runAt.getTime()
  const mentionsSinceId = input.lastMentionId

  if (!coverage.live || !coverage.lastOkTo) {
    const from = iso(at - sync.backfillDays * DAY_MS)
    return { type: "backfill", from, mentionsSinceId, repliesFrom: from }
  }

  const resume = ms(coverage.lastOkTo) - OVERLAP_MS
  const full = input.lastFullRefreshDay !== dateKeyIn(input.runAt, input.timeZone)
  const fullSpan = sync.fullRefreshDays * DAY_MS
  const span = full ? fullSpan : sync.lightRefreshHours * HOUR_MS
  const from = Math.max(Math.min(at - span, resume), at - MAX_CATCH_UP_DAYS * DAY_MS)

  // Missed runs: the window reaches further back than this run type normally does.
  let type: RunType = full ? "full" : "light"
  if (resume < at - span) type = "catch-up"

  // new-only: replies are stored when new (after the coverage end) but older ones aren't refreshed.
  const repliesFrom = sync.refreshReplies === "new-only" ? iso(Math.max(resume, from)) : iso(from)
  return { type, from: iso(from), mentionsSinceId, repliesFrom }
}
