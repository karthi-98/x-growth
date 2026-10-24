import { and, desc, gte, like, lt, ne, sql } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { addDays, dateKeyIn } from "@/lib/dates"
import { db } from "@/lib/db/client"
import {
  posts,
  postTypes,
  type DashboardPost,
  type PostType,
} from "@/lib/db/schema"
import { sumByPostDay, totalsByType } from "@/lib/insights/daily"
import { zonedDays } from "@/lib/insights/zoned"
import { rangeDays } from "@/lib/range"

export const metricKeys = [
  "impressions",
  "likes",
  "replies",
  "bookmarks",
  "posts",
] as const
export type MetricKey = (typeof metricKeys)[number]

export type MetricSummary = {
  key: MetricKey
  current: number
  /** Null when stored data does not fully cover the previous period. */
  previous: number | null
  /** Fractional change vs previous period, null when not comparable. */
  change: number | null
}

export type DashboardData = {
  days: number
  range: { from: string; to: string }
  metrics: MetricSummary[]
  /** Lifetime numbers summed on each post's local post date. */
  series: { date: string; impressions: number; likes: number }[]
  byType: { type: PostType; impressions: number; posts: number }[]
  topPosts: DashboardPost[]
  isSample: boolean
  /** Latest fetched_at across stored posts (ISO), null when empty. */
  updatedAt: string | null
}

/** Reposts are stored but never counted anywhere on the dashboard. */
const notRepost = ne(posts.type, "repost")

/** First and last local post dates (reposts excluded), null when empty. */
async function loadDataBounds(timeZone: string): Promise<{ min: string; max: string } | null> {
  await connection()
  const [row] = await db
    .select({
      min: sql<string | null>`min(${posts.createdAt})`,
      max: sql<string | null>`max(${posts.createdAt})`,
    })
    .from(posts)
    .where(notRepost)
  if (!row?.min || !row.max) return null
  return { min: dateKeyIn(new Date(row.min), timeZone), max: dateKeyIn(new Date(row.max), timeZone) }
}
export const getDataBounds = cache(loadDataBounds)

/**
 * Dashboard numbers for an inclusive range of local dates. Days are bucketed
 * from `posts` in `timeZone` (daily_stats is keyed by IST dates, so it can't
 * serve other zones), with the previous period of equal length for deltas.
 */
async function loadDashboardData(from: string, to: string, timeZone: string): Promise<DashboardData> {
  // The DB changes outside the build, so read it per request.
  await connection()

  const days = rangeDays({ from, to })
  const prevStart = addDays(from, -days)
  const span = zonedDays(prevStart, to, timeZone)
  const current = zonedDays(from, to, timeZone)

  const rows = await db
    .select({
      createdAt: posts.createdAt,
      type: posts.type,
      impressions: posts.impressions,
      likes: posts.likes,
      replies: posts.replies,
      bookmarks: posts.bookmarks,
    })
    .from(posts)
    .where(and(notRepost, gte(posts.createdAt, span.start), lt(posts.createdAt, span.end)))

  const daily = sumByPostDay(rows, span)
  const previousDays = daily.slice(0, days)
  const currentDays = daily.slice(days)

  // Only compare when stored data reaches back over the whole previous period.
  const bounds = await getDataBounds(timeZone)
  const hasPrevious = bounds !== null && bounds.min <= prevStart

  const metrics = metricKeys.map((key) => {
    const sum = (list: typeof daily) => list.reduce((acc, d) => acc + d[key], 0)
    const value = sum(currentDays)
    const previous = hasPrevious ? sum(previousDays) : null
    return {
      key,
      current: value,
      previous,
      change: previous ? (value - previous) / previous : null,
    }
  })

  const series = currentDays.map(({ date, impressions, likes }) => ({ date, impressions, likes }))

  const typeTotals = totalsByType(rows, current)
  const byType = postTypes
    .map((type) => ({
      type,
      impressions: typeTotals.get(type)?.impressions ?? 0,
      posts: typeTotals.get(type)?.posts ?? 0,
    }))
    .filter((t) => t.type !== "reply" || t.posts > 0)

  // The range excludes reposts, so every row is a dashboard type.
  const topPosts = (await db
    .select()
    .from(posts)
    .where(and(notRepost, gte(posts.createdAt, current.start), lt(posts.createdAt, current.end)))
    .orderBy(desc(posts.impressions))
    .limit(10)) as DashboardPost[]

  const [{ samples, updatedAt }] = await db
    .select({
      samples: sql<number>`sum(case when ${like(posts.id, "sample-%")} then 1 else 0 end)`,
      updatedAt: sql<string | null>`max(${posts.fetchedAt})`,
    })
    .from(posts)

  return {
    days,
    range: { from, to },
    metrics,
    series,
    byType,
    topPosts,
    isSample: Number(samples ?? 0) > 0,
    updatedAt,
  }
}

/** Deduped per request so the header and the dashboard share one read. */
export const getDashboardData = cache(loadDashboardData)
