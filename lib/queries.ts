import { and, asc, desc, gte, like, lt, lte, ne, sql } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { addDays, istDateKey } from "@/lib/dates"
import { db } from "@/lib/db/client"
import {
  dailyStats,
  posts,
  postTypes,
  type DashboardPost,
  type PostType,
} from "@/lib/db/schema"
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
  series: { date: string; impressions: number; likes: number }[]
  byType: { type: PostType; impressions: number; posts: number }[]
  topPosts: DashboardPost[]
  isSample: boolean
  /** Latest fetched_at across stored posts (ISO), null when empty. */
  updatedAt: string | null
}

/** UTC ISO instant for 00:00 IST on a YYYY-MM-DD key. */
const istMidnight = (key: string) =>
  new Date(`${key}T00:00:00+05:30`).toISOString()

/** Reposts are stored but never counted anywhere on the dashboard. */
const notRepost = ne(posts.type, "repost")

/** First and last IST post dates (reposts excluded), null when empty. */
async function loadDataBounds(): Promise<{ min: string; max: string } | null> {
  await connection()
  const [row] = await db
    .select({
      min: sql<string | null>`min(${posts.createdAt})`,
      max: sql<string | null>`max(${posts.createdAt})`,
    })
    .from(posts)
    .where(notRepost)
  if (!row?.min || !row.max) return null
  return { min: istDateKey(new Date(row.min)), max: istDateKey(new Date(row.max)) }
}
export const getDataBounds = cache(loadDataBounds)

async function loadDashboardData(from: string, to: string): Promise<DashboardData> {
  // The DB changes outside the build, so read it per request.
  await connection()

  const days = rangeDays({ from, to })
  const prevStart = addDays(from, -days)
  const prevEnd = addDays(from, -1)

  const rows = await db
    .select()
    .from(dailyStats)
    .where(and(gte(dailyStats.date, prevStart), lte(dailyStats.date, to)))
    .orderBy(asc(dailyStats.date))

  const [{ earliest }] = await db
    .select({ earliest: sql<string | null>`min(${dailyStats.date})` })
    .from(dailyStats)
  // Only compare when stored data reaches back over the whole previous period.
  const hasPrevious = earliest !== null && earliest <= prevStart

  const sum = (key: MetricKey, a: string, b: string) =>
    rows
      .filter((d) => d.date >= a && d.date <= b)
      .reduce((acc, d) => acc + d[key], 0)

  const metrics = metricKeys.map((key) => {
    const current = sum(key, from, to)
    const previous = hasPrevious ? sum(key, prevStart, prevEnd) : null
    return {
      key,
      current,
      previous,
      change: previous ? (current - previous) / previous : null,
    }
  })

  const byDate = new Map(rows.map((d) => [d.date, d]))
  const series = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i)
    const d = byDate.get(date)
    return { date, impressions: d?.impressions ?? 0, likes: d?.likes ?? 0 }
  })

  const inRange = and(
    notRepost,
    gte(posts.createdAt, istMidnight(from)),
    lt(posts.createdAt, istMidnight(addDays(to, 1)))
  )

  const typeRows = await db
    .select({
      type: posts.type,
      impressions: sql<number>`coalesce(sum(${posts.impressions}), 0)`,
      posts: sql<number>`count(*)`,
    })
    .from(posts)
    .where(inRange)
    .groupBy(posts.type)

  const byType = postTypes
    .map((type) => {
      const row = typeRows.find((r) => r.type === type)
      return {
        type,
        impressions: Number(row?.impressions ?? 0),
        posts: Number(row?.posts ?? 0),
      }
    })
    .filter((t) => t.type !== "reply" || t.posts > 0)

  // inRange excludes reposts, so every row is a dashboard type.
  const topPosts = (await db
    .select()
    .from(posts)
    .where(inRange)
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
