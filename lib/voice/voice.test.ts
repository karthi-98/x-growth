import { beforeAll, describe, expect, test } from "bun:test"

import { blockNetwork, useTestDataDir } from "@/lib/ai/testing/env"

import { cleanPostText, selectVoicePosts, type VoicePostInput } from "./select"
import { describeVoice, topThemes, voiceStats } from "./style"

let n = 0
const post = (p: Partial<VoicePostInput>): VoicePostInput => ({
  id: String(++n),
  text: `Post number ${n} about building in public`,
  type: "original",
  createdAt: "2026-10-01T00:00:00.000Z",
  impressions: 1000,
  likes: 10,
  replies: 0,
  reposts: 0,
  quotes: 0,
  bookmarks: 0,
  ...p,
})

describe("selectVoicePosts", () => {
  test("ranks originals by engagement rate above the impressions floor", () => {
    const posts = [
      post({ id: "low-rate", impressions: 1000, likes: 5 }),
      post({ id: "best", impressions: 500, likes: 40, replies: 10 }),
      post({ id: "mid", impressions: 2000, likes: 60 }),
      // High rate but too few impressions to trust.
      post({ id: "noisy", impressions: 50, likes: 25 }),
      // Not originals.
      post({ id: "reply", type: "reply", impressions: 1000, likes: 500 }),
      post({ id: "quote", type: "quote", impressions: 1000, likes: 500 }),
      post({ id: "repost", type: "repost", impressions: 1000, likes: 500 }),
      // Media-only: nothing left after the t.co link.
      post({ id: "media", text: "https://t.co/abc123", impressions: 1000, likes: 500 }),
      ...Array.from({ length: 10 }, (_, i) => post({ id: `filler-${i}`, impressions: 300, likes: 1 })),
    ]
    const sel = selectVoicePosts(posts, { limit: 3 })
    expect(sel.minImpressions).toBe(200)
    expect(sel.posts.map((p) => p.id)).toEqual(["best", "mid", "low-rate"])
    expect(sel.posts[0].engagementRate).toBeCloseTo(0.1, 10)
    expect(sel.posts[0].engagements).toBe(50)
  })

  test("caps at 30 by default", () => {
    const posts = Array.from({ length: 50 }, (_, i) => post({ impressions: 1000, likes: i }))
    expect(selectVoicePosts(posts).posts).toHaveLength(30)
  })

  test("small accounts fall back to a lower floor", () => {
    const posts = Array.from({ length: 12 }, (_, i) => post({ impressions: 30 + i, likes: 1 }))
    const sel = selectVoicePosts(posts)
    expect(sel.minImpressions).toBeLessThan(200)
    expect(sel.posts.length).toBeGreaterThan(0)
  })

  test("cleans media links and HTML entities", () => {
    expect(cleanPostText("Builders &amp; makers 🔥 https://t.co/AbC https://t.co/x9")).toBe("Builders & makers 🔥")
  })
})

describe("style summary", () => {
  test("describes habits from the posts", () => {
    const texts = [
      "I shipped it 🔥\n\nWhat should I build next?",
      "My first payout came in 🥳\n\nSo HAPPY right now",
      "I hit 1k followers 🔥\n\nThank you all!",
    ]
    const stats = voiceStats(texts)
    expect(stats.posts).toBe(3)
    expect(stats.emoji).toBe(1)
    expect(stats.topEmoji[0]).toBe("🔥")
    const lines = describeVoice(stats)
    expect(lines).toContain("Splits thoughts into short lines with blank lines between them.")
    expect(lines.some((l) => l.startsWith("Uses emoji in most posts"))).toBe(true)
    expect(lines).toContain("Doesn't use hashtags.")
    expect(topThemes(["payouts are here", "more payouts soon", "followers"])).toEqual(["payouts"])
  })

  test("empty history still gives guidance", () => {
    expect(describeVoice(voiceStats([]))).toHaveLength(1)
  })
})

describe("voice profile file", () => {
  let profile: typeof import("./profile")
  let db: (typeof import("@/lib/db/client"))["db"]
  let schema: typeof import("@/lib/db/schema")

  beforeAll(async () => {
    blockNetwork()
    await useTestDataDir()
    profile = await import("./profile")
    db = (await import("@/lib/db/client")).db
    schema = await import("@/lib/db/schema")
  })

  test("builds from the posts table, saves JSON in the data dir, rebuilds when a week old", async () => {
    const { paths } = await import("@/lib/paths")
    await db.delete(schema.posts)
    await db.insert(schema.posts).values(
      Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        createdAt: "2026-10-01T00:00:00.000Z",
        text: `I launched feature ${i} today 🔥\n\nWhat do you think?`,
        type: i < 12 ? ("original" as const) : ("reply" as const),
        impressions: 300 + i * 10,
        likes: i,
        fetchedAt: "2026-10-02T00:00:00.000Z",
      }))
    )
    const now = new Date("2026-10-24T00:00:00.000Z")
    const built = await profile.buildVoiceProfile(now)
    expect(built.examples).toHaveLength(12)
    expect(built.examples[0].id).toBe("p11")
    expect(built.summary.length).toBeGreaterThan(2)
    expect(paths.voiceProfile.startsWith(paths.data)).toBe(true)
    expect(profile.readVoiceProfile()?.builtAt).toBe(now.toISOString())

    // Fresh: reused as is.
    const sameWeek = await profile.getVoiceProfile(new Date("2026-10-28T00:00:00.000Z"))
    expect(sameWeek.builtAt).toBe(now.toISOString())
    // Over a week old: rebuilt.
    const later = new Date("2026-11-01T00:00:01.000Z")
    expect(profile.isVoiceProfileStale(sameWeek, later)).toBe(true)
    expect((await profile.getVoiceProfile(later)).builtAt).toBe(later.toISOString())
  })
})
