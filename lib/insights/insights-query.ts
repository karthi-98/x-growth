import { and, gte, inArray, lt, ne } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { addDays, dateKeyIn } from "@/lib/dates"
import { db } from "@/lib/db/client"
import { posts } from "@/lib/db/schema"
import { consistency, type Consistency } from "@/lib/insights/consistency"
import { buildHeatmap, type Heatmap } from "@/lib/insights/heatmap"
import {
  byLength,
  byPostType,
  topByEngagementRate,
  type InsightPost,
} from "@/lib/insights/performance"
import { zonedDays, zonedParts } from "@/lib/insights/zoned"
import { getDataBounds } from "@/lib/queries"

/** Time ranges on /insights (?range=). */
export const insightsRanges = ["30d", "90d", "all"] as const
export type InsightsRange = (typeof insightsRanges)[number]
export const DEFAULT_INSIGHTS_RANGE: InsightsRange = "90d"

export const INSIGHTS_RANGE_LABELS: Record<InsightsRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
}

export function parseInsightsRange(value: string | string[] | undefined): InsightsRange {
  const v = Array.isArray(value) ? value[0] : value
  return insightsRanges.includes(v as InsightsRange) ? (v as InsightsRange) : DEFAULT_INSIGHTS_RANGE
}

/** Posts younger than this are still gaining impressions, so they're left out of scores. */
export const MATURE_AFTER_HOURS = 48

export type InsightsData = {
  range: { from: string; to: string }
  /** Posts (originals + quotes) and replies in range, before the maturity cut. */
  counts: { posts: number; replies: number; scored: number }
  heatmap: Heatmap
  byType: ReturnType<typeof byPostType>
  byLength: ReturnType<typeof byLength>
  topEngagement: ReturnType<typeof topByEngagementRate>
  consistency: Consistency
}

async function loadInsights(range: InsightsRange, timeZone: string): Promise<InsightsData | null> {
  // The DB changes outside the build, so read it per request.
  await connection()
  const now = new Date()
  const today = dateKeyIn(now, timeZone)
  const bounds = await getDataBounds(timeZone)
  if (!bounds) return null

  // Never start before the first stored post, so averages aren't diluted.
  const wanted = range === "all" ? bounds.min : addDays(today, range === "30d" ? -29 : -89)
  const from = wanted < bounds.min ? bounds.min : wanted
  const { start, end } = zonedDays(from, today, timeZone)

  const rows = (await db
    .select({
      id: posts.id,
      createdAt: posts.createdAt,
      type: posts.type,
      text: posts.text,
      url: posts.url,
      impressions: posts.impressions,
      likes: posts.likes,
      replies: posts.replies,
      reposts: posts.reposts,
      quotes: posts.quotes,
      bookmarks: posts.bookmarks,
    })
    .from(posts)
    .where(and(ne(posts.type, "repost"), gte(posts.createdAt, start), lt(posts.createdAt, end)))) as InsightPost[]

  const allPostTimes = await db
    .select({ createdAt: posts.createdAt })
    .from(posts)
    .where(inArray(posts.type, ["original", "quote"]))
  const postDays = new Set(allPostTimes.map((p) => zonedParts(p.createdAt, timeZone).key))

  const cutoff = now.getTime() - MATURE_AFTER_HOURS * 3_600_000
  const mature = rows.filter((p) => Date.parse(p.createdAt) <= cutoff)
  const matureOwn = mature.filter((p) => p.type === "original" || p.type === "quote")

  return {
    range: { from, to: today },
    counts: {
      posts: rows.filter((p) => p.type === "original" || p.type === "quote").length,
      replies: rows.filter((p) => p.type === "reply").length,
      scored: matureOwn.length,
    },
    heatmap: buildHeatmap(matureOwn, timeZone),
    byType: byPostType(mature),
    byLength: byLength(matureOwn),
    topEngagement: topByEngagementRate(matureOwn),
    consistency: consistency(rows, postDays, from, today, today, timeZone),
  }
}

/** Everything /insights shows for a range, from the local DB; null before any posts exist. */
export const getInsights = cache(loadInsights)
