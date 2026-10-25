import { describe, expect, test } from "bun:test"

import { consistency } from "@/lib/insights/consistency"
import {
  byLength,
  byPostType,
  lengthBucket,
  textLength,
  topByEngagementRate,
  type InsightPost,
} from "@/lib/insights/performance"

let n = 0
const post = (over: Partial<InsightPost>): InsightPost => ({
  id: String(++n),
  createdAt: "2026-10-01T10:00:00Z",
  type: "original",
  text: "hello",
  url: null,
  impressions: 1000,
  likes: 10,
  replies: 0,
  reposts: 0,
  quotes: 0,
  bookmarks: 0,
  ...over,
})

describe("performance", () => {
  test("text length skips t.co links and leading mentions", () => {
    expect(textLength("@a @b_c hi there https://t.co/xyz")).toBe(8)
    expect(textLength("👋🏽 hi")).toBe(5)
    expect(lengthBucket("x".repeat(49))).toBe("xs")
    expect(lengthBucket("x".repeat(280))).toBe("l")
    expect(lengthBucket("x".repeat(281))).toBe("xl")
  })

  test("by type keeps every type and uses medians", () => {
    const rows = byPostType([
      post({ impressions: 100 }),
      post({ impressions: 300 }),
      post({ impressions: 10_000 }),
      post({ type: "quote", impressions: 50, likes: 5 }),
    ])
    expect(rows.map((r) => r.type)).toEqual(["original", "reply", "quote"])
    expect(rows[0]).toMatchObject({ posts: 3, medianImpressions: 300, totalImpressions: 10_400 })
    expect(rows[1]).toMatchObject({ posts: 0, medianImpressions: null, medianRate: null })
    expect(rows[2].medianRate).toBeCloseTo(0.1)
  })

  test("length buckets flag small samples", () => {
    const rows = byLength([post({ text: "short" }), post({ text: "x".repeat(120) })])
    expect(rows.find((b) => b.key === "xs")).toMatchObject({ posts: 1, enough: false })
    expect(rows.find((b) => b.key === "xl")).toMatchObject({ posts: 0, medianImpressions: null })
  })

  test("top engagement needs at least the median impressions", () => {
    const top = topByEngagementRate([
      post({ id: "tiny", impressions: 120, likes: 60 }),
      post({ id: "big", impressions: 5000, likes: 400 }),
      post({ id: "mid", impressions: 2000, likes: 100 }),
    ])
    expect(top.minImpressions).toBe(2000)
    expect(top.posts.map((p) => p.id)).toEqual(["big", "mid"])
    expect(top.posts[0].rate).toBeCloseTo(0.08)
  })
})

describe("consistency", () => {
  const tz = "Asia/Kolkata"
  const at = (day: string, type: InsightPost["type"] = "original") => ({ createdAt: `${day}T06:00:00Z`, type })

  test("averages, active days, streaks and weeks", () => {
    const rows = [
      at("2026-10-19"),
      at("2026-10-20"),
      at("2026-10-20", "quote"),
      at("2026-10-21", "reply"),
      at("2026-10-23"),
      at("2026-10-24"),
    ]
    const postDays = new Set(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-23", "2026-10-24"])
    const c = consistency(rows, postDays, "2026-10-18", "2026-10-24", "2026-10-24", tz)
    expect(c).toMatchObject({ days: 7, posts: 5, replies: 1, activeDays: 4, currentStreak: 2 })
    expect(c.postsPerWeek).toBeCloseTo(5)
    expect(c.longestStreak).toEqual({ days: 2, from: "2026-10-19", to: "2026-10-20" })
    expect(c.weeks).toEqual([
      { week: "2026-10-12", posts: 0, replies: 0, days: 1 },
      { week: "2026-10-19", posts: 5, replies: 1, days: 6 },
    ])
  })

  test("a streak survives until today ends", () => {
    const postDays = new Set(["2026-10-22", "2026-10-23"])
    expect(consistency([], postDays, "2026-10-20", "2026-10-24", "2026-10-24", tz).currentStreak).toBe(2)
    expect(consistency([], postDays, "2026-10-20", "2026-10-25", "2026-10-25", tz).currentStreak).toBe(0)
  })
})
