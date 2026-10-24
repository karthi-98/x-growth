import { addDays } from "@/lib/dates"
import { zonedDays, zonedParts } from "@/lib/insights/zoned"

/*
 * Follower growth (account_snapshots) and impressions gained per day
 * (post_metric_snapshots deltas), bucketed by local day. Pure; the queries
 * live in lib/insights/growth-query.ts.
 */

export type FollowerPoint = { date: string; followers: number | null }

export type FollowerGrowth = {
  /** Follower count at the end of each local day (last snapshot so far), null before the first. */
  points: FollowerPoint[]
  /** Newest snapshot at or before the end of the range. */
  latest: { followers: number; takenAt: string } | null
  /** Change over the range, from the last count before it (else the first inside it). */
  change: number | null
  /** The baseline came from inside the range: tracking started mid-range. */
  startedInRange: boolean
}

/** `snapshots` sorted by takenAt ascending. */
export function followerGrowth(
  snapshots: { takenAt: string; followers: number }[],
  from: string,
  to: string,
  timeZone: string
): FollowerGrowth {
  const days = zonedDays(from, to, timeZone)
  const startMs = days.bounds[0]
  let baseline: number | null = null
  let firstInside: number | null = null
  let latest: FollowerGrowth["latest"] = null

  const points: FollowerPoint[] = []
  let j = 0
  for (let i = 0; i < days.keys.length; i++) {
    const dayEnd = days.bounds[i + 1]
    while (j < snapshots.length && Date.parse(snapshots[j].takenAt) < dayEnd) {
      const s = snapshots[j]
      const ms = Date.parse(s.takenAt)
      if (ms < startMs) baseline = s.followers
      else if (firstInside === null) firstInside = s.followers
      latest = { followers: s.followers, takenAt: s.takenAt }
      j++
    }
    points.push({ date: days.keys[i], followers: latest?.followers ?? null })
  }

  const start = baseline ?? firstInside
  return {
    points,
    latest,
    change: latest && start !== null ? latest.followers - start : null,
    startedInRange: baseline === null && firstInside !== null,
  }
}

/** Full local days of snapshot history needed before "gained per day" replaces the fallback. */
export const MIN_TRACKED_DAYS = 2

export type GainedRow = {
  /** Sync time (UTC ISO, minute precision is enough). */
  at: string
  /** Impressions gained by every post since its previous snapshot. */
  gained: number
}

export type ImpressionsGained = {
  /** Gained per local day; null for days before tracking covered a whole day. */
  series: { date: string; impressions: number | null }[]
  /** First local day fully covered by snapshots. */
  trackedFrom: string
}

/**
 * The first local day fully covered by snapshots (the day after the first
 * snapshot), or null while fewer than MIN_TRACKED_DAYS such days have ended.
 */
export function trackedFromDay(firstSnapshotAt: string | null, today: string, timeZone: string): string | null {
  if (!firstSnapshotAt) return null
  const first = addDays(zonedParts(firstSnapshotAt, timeZone).key, 1)
  return addDays(first, MIN_TRACKED_DAYS - 1) < today ? first : null
}

/**
 * Impressions gained per local day over an inclusive range, or null when the
 * caller should fall back to lifetime totals by post date: not enough
 * snapshot history yet, or the range ends before tracking began.
 */
export function gainedPerDay(
  rows: GainedRow[],
  from: string,
  to: string,
  timeZone: string,
  trackedFrom: string | null
): ImpressionsGained | null {
  if (!trackedFrom || to < trackedFrom) return null
  const days = zonedDays(from, to, timeZone)
  const sums = days.keys.map(() => 0)
  for (const r of rows) {
    const i = days.indexOf(r.at)
    if (i >= 0) sums[i] += r.gained
  }
  return {
    series: days.keys.map((date, i) => ({ date, impressions: date < trackedFrom ? null : sums[i] })),
    trackedFrom,
  }
}
