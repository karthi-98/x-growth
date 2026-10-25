import { postTypes, type PostType } from "@/lib/db/schema"
import { median } from "@/lib/insights/stats"

/*
 * What performs: post type, text length and engagement rate, from each
 * post's lifetime public metrics. Pure; lib/insights/insights-query.ts
 * feeds it rows.
 */

export type InsightPost = {
  id: string
  createdAt: string
  type: PostType
  text: string
  url: string | null
  impressions: number
  likes: number
  replies: number
  reposts: number
  quotes: number
  bookmarks: number
}

/** Public interactions X reports per post (no link clicks or profile visits). */
export const engagementsOf = (p: InsightPost) => p.likes + p.replies + p.reposts + p.quotes + p.bookmarks

/** Engagements per impression, null without impressions. */
export const engagementRate = (p: InsightPost) => (p.impressions > 0 ? engagementsOf(p) / p.impressions : null)

export type GroupStats = {
  posts: number
  totalImpressions: number
  medianImpressions: number | null
  /** Median of per-post engagement rates (posts with impressions only). */
  medianRate: number | null
}

export function groupStats(posts: InsightPost[]): GroupStats {
  const rates = posts.flatMap((p) => {
    const r = engagementRate(p)
    return r === null ? [] : [r]
  })
  return {
    posts: posts.length,
    totalImpressions: posts.reduce((a, p) => a + p.impressions, 0),
    medianImpressions: median(posts.map((p) => p.impressions)),
    medianRate: median(rates),
  }
}

/** Every dashboard type, in the app's order, even when empty. */
export function byPostType(posts: InsightPost[]): (GroupStats & { type: PostType })[] {
  return postTypes.map((type) => ({ type, ...groupStats(posts.filter((p) => p.type === type)) }))
}

/** Text length buckets (characters, links and leading @mentions left out). */
export const LENGTH_BUCKETS = [
  { key: "xs", label: "Under 50", max: 49 },
  { key: "s", label: "50–99", max: 99 },
  { key: "m", label: "100–179", max: 179 },
  { key: "l", label: "180–280", max: 280 },
  { key: "xl", label: "Over 280", max: Number.POSITIVE_INFINITY },
] as const
export type LengthBucketKey = (typeof LENGTH_BUCKETS)[number]["key"]

/** Posts a length bucket needs before its numbers are shown as reliable. */
export const LENGTH_MIN_POSTS = 5

/**
 * Characters the reader sees as text: t.co links (media and URLs) and the
 * leading @mentions X adds to replies don't count. Code points, so an emoji
 * counts once.
 */
export function textLength(text: string): number {
  const visible = text
    .replace(/https?:\/\/t\.co\/\S+/g, "")
    .replace(/^(?:@\w+\s+)+/, "")
    .trim()
  return Array.from(visible).length
}

export function lengthBucket(text: string): LengthBucketKey {
  const n = textLength(text)
  return LENGTH_BUCKETS.find((b) => n <= b.max)!.key
}

export function byLength(
  posts: InsightPost[]
): (GroupStats & { key: LengthBucketKey; label: string; enough: boolean })[] {
  const groups = new Map<LengthBucketKey, InsightPost[]>()
  for (const p of posts) {
    const key = lengthBucket(p.text)
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return LENGTH_BUCKETS.map(({ key, label }) => {
    const stats = groupStats(groups.get(key) ?? [])
    return { key, label, ...stats, enough: stats.posts >= LENGTH_MIN_POSTS }
  })
}

/** Floor for "top by engagement rate", so a post with 3 views and 1 like can't win. */
export const MIN_RATE_IMPRESSIONS = 100

export type RatedPost = InsightPost & { rate: number; engagements: number }

/**
 * Highest engagement rates among posts with at least `minImpressions`
 * impressions: by default the median of the posts given (and never under
 * MIN_RATE_IMPRESSIONS), so the list reflects posts that reached people.
 */
export function topByEngagementRate(
  posts: InsightPost[],
  { limit = 10, minImpressions }: { limit?: number; minImpressions?: number } = {}
): { minImpressions: number; posts: RatedPost[] } {
  const floor = Math.max(
    MIN_RATE_IMPRESSIONS,
    Math.round(minImpressions ?? median(posts.map((p) => p.impressions)) ?? 0)
  )
  const rated = posts
    .filter((p) => p.impressions >= floor)
    .map((p) => ({ ...p, engagements: engagementsOf(p), rate: engagementsOf(p) / p.impressions }))
    .sort((a, b) => b.rate - a.rate || b.impressions - a.impressions)
    .slice(0, limit)
  return { minImpressions: floor, posts: rated }
}
