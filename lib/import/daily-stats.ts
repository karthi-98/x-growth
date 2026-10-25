import { and, gte, inArray, lt, ne, sql } from "drizzle-orm"

import { addDays, dateKeyIn, zonedDayStartUtc } from "../dates"
import { dailyStats, posts, type NewDailyStat } from "../db/schema"
import type { Queryable } from "./db"

const emptyDay = (date: string): NewDailyStat => ({
  date,
  posts: 0,
  impressions: 0,
  likes: 0,
  replies: 0,
  reposts: 0,
  bookmarks: 0,
})

/**
 * Rebuild daily_stats for every local date from `from` to `to` (YYYY-MM-DD in
 * `timeZone`, zero-filled), summing stored originals, replies and quotes.
 * Reposts are stored but never counted. Returns the number of days written.
 */
export async function rebuildDailyStats(q: Queryable, from: string, to: string, timeZone: string): Promise<number> {
  if (from > to) return 0
  const dates: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)

  const stored = await q
    .select({
      createdAt: posts.createdAt,
      impressions: posts.impressions,
      likes: posts.likes,
      replies: posts.replies,
      reposts: posts.reposts,
      bookmarks: posts.bookmarks,
    })
    .from(posts)
    .where(
      and(
        ne(posts.type, "repost"),
        gte(posts.createdAt, zonedDayStartUtc(from, timeZone)),
        lt(posts.createdAt, zonedDayStartUtc(addDays(to, 1), timeZone))
      )
    )
  const totals = new Map(dates.map((d) => [d, emptyDay(d)]))
  for (const p of stored) {
    const t = totals.get(dateKeyIn(new Date(p.createdAt), timeZone))
    if (!t) continue
    t.posts! += 1
    t.impressions! += p.impressions
    t.likes! += p.likes
    t.replies! += p.replies
    t.reposts! += p.reposts
    t.bookmarks! += p.bookmarks
  }
  for (let i = 0; i < dates.length; i += 200) {
    await q.delete(dailyStats).where(inArray(dailyStats.date, dates.slice(i, i + 200)))
  }
  const rows = [...totals.values()]
  for (let i = 0; i < rows.length; i += 200) {
    await q.insert(dailyStats).values(rows.slice(i, i + 200))
  }
  return rows.length
}

/**
 * Rebuild daily_stats from scratch over every stored post date, e.g. after
 * the timezone changes. Returns the date range written, or null when empty.
 */
export async function rebuildAllDailyStats(q: Queryable, timeZone: string): Promise<{ from: string; to: string } | null> {
  const [row] = await q
    .select({ min: sql<string | null>`min(${posts.createdAt})`, max: sql<string | null>`max(${posts.createdAt})` })
    .from(posts)
    .where(ne(posts.type, "repost"))
  await q.delete(dailyStats)
  if (!row?.min || !row.max) return null
  const from = dateKeyIn(new Date(row.min), timeZone)
  const to = dateKeyIn(new Date(row.max), timeZone)
  await rebuildDailyStats(q, from, to, timeZone)
  return { from, to }
}
