import type { PostType, StoredPostType } from "@/lib/db/schema"
import { zonedDays, type ZonedDays } from "@/lib/insights/zoned"

/*
 * Per-day totals bucketed in the settings timezone. Pure, so the queries in
 * lib/queries.ts and lib/activity-query.ts stay thin and the bucketing is
 * unit-tested across DST changes.
 */

export type DayTotals = {
  date: string
  posts: number
  impressions: number
  likes: number
  replies: number
  bookmarks: number
}

export type MetricRow = {
  createdAt: string
  type: StoredPostType
  impressions: number
  likes: number
  replies: number
  bookmarks: number
}

/**
 * Sum each non-repost post's lifetime numbers on the local day it was
 * posted (what daily_stats holds for IST), zero-filled over `days`.
 */
export function sumByPostDay(rows: MetricRow[], days: ZonedDays): DayTotals[] {
  const out = days.keys.map((date) => ({ date, posts: 0, impressions: 0, likes: 0, replies: 0, bookmarks: 0 }))
  for (const r of rows) {
    if (r.type === "repost") continue
    const i = days.indexOf(r.createdAt)
    if (i < 0) continue
    const d = out[i]
    d.posts += 1
    d.impressions += r.impressions
    d.likes += r.likes
    d.replies += r.replies
    d.bookmarks += r.bookmarks
  }
  return out
}

export type ActivityDay = { date: string; posts: number; replies: number }

/** Per local day: posts = originals + quotes, replies = replies made. Zero-filled. */
export function countActivityByDay(
  rows: { createdAt: string; type: StoredPostType }[],
  from: string,
  to: string,
  timeZone: string
): ActivityDay[] {
  const days = zonedDays(from, to, timeZone)
  const out = days.keys.map((date) => ({ date, posts: 0, replies: 0 }))
  for (const r of rows) {
    const i = days.indexOf(r.createdAt)
    if (i < 0) continue
    if (r.type === "original" || r.type === "quote") out[i].posts += 1
    else if (r.type === "reply") out[i].replies += 1
  }
  return out
}

/** Impressions and post counts per dashboard type for rows inside `days`. */
export function totalsByType(
  rows: { createdAt: string; type: StoredPostType; impressions: number }[],
  days: ZonedDays
): Map<PostType, { impressions: number; posts: number }> {
  const out = new Map<PostType, { impressions: number; posts: number }>()
  for (const r of rows) {
    if (r.type === "repost" || days.indexOf(r.createdAt) < 0) continue
    const t = out.get(r.type) ?? { impressions: 0, posts: 0 }
    t.impressions += r.impressions
    t.posts += 1
    out.set(r.type, t)
  }
  return out
}
