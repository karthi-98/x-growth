import { and, eq, gte } from "drizzle-orm"

import { db as defaultDb } from "../db/client"
import { posts } from "../db/schema"
import { nextZonedSlot, weekdayName, zonedWeekdayHour } from "./zoned"

/*
 * Best time to post: median impressions of the user's own originals by
 * weekday × hour in settings.timeZone. Medians, so one viral post doesn't
 * make its hour look like the best one.
 */

export type BestTimeSlot = {
  weekday: number
  hour: number
  /** "Tue 18:00" */
  label: string
  median: number
  posts: number
  /** Next occurrence, as a datetime-local value and a UTC instant. */
  next: { local: string; utc: string }
}

export type BestTimeHint = { slots: BestTimeSlot[]; sample: number; days: number }

/** Look back this far; older posts reached a different audience. */
const LOOKBACK_DAYS = 180
/** A slot needs this many originals to be ranked; fewer and one lucky post decides it. */
const MIN_POSTS = 5

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Rank weekday × hour slots from (createdAt, impressions) rows. Pure, for tests. */
export function rankSlots(
  rows: { createdAt: string; impressions: number }[],
  timeZone: string,
  now: Date,
  { limit = 3, minPosts = MIN_POSTS } = {}
): BestTimeSlot[] {
  const cells = new Map<number, number[]>()
  for (const r of rows) {
    const { weekday, hour } = zonedWeekdayHour(new Date(r.createdAt), timeZone)
    const key = weekday * 24 + hour
    const list = cells.get(key)
    if (list) list.push(r.impressions)
    else cells.set(key, [r.impressions])
  }
  return [...cells.entries()]
    .filter(([, list]) => list.length >= minPosts)
    .map(([key, list]) => {
      const weekday = Math.floor(key / 24)
      const hour = key % 24
      return {
        weekday,
        hour,
        label: `${weekdayName(weekday)} ${String(hour).padStart(2, "0")}:00`,
        median: median(list),
        posts: list.length,
        next: nextZonedSlot(now, timeZone, weekday, hour),
      }
    })
    .sort((a, b) => b.median - a.median || b.posts - a.posts)
    .slice(0, limit)
}

export async function bestTimeHint(timeZone: string, now = new Date(), db = defaultDb): Promise<BestTimeHint | null> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const rows = await db
    .select({ createdAt: posts.createdAt, impressions: posts.impressions })
    .from(posts)
    .where(and(eq(posts.type, "original"), gte(posts.createdAt, since)))
  const slots = rankSlots(rows, timeZone, now)
  return slots.length ? { slots, sample: rows.length, days: LOOKBACK_DAYS } : null
}
