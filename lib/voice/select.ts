import { decodeXEntities } from "@/lib/ai/text"
import type { Post } from "@/lib/db/schema"

/*
 * Which of the user's posts define their voice: originals (no replies,
 * quotes or reposts) ranked by engagement rate, among posts with enough
 * impressions that the rate means something. Pure, so it's easy to test.
 */

export type VoicePostInput = Pick<
  Post,
  "id" | "text" | "type" | "createdAt" | "impressions" | "likes" | "replies" | "reposts" | "quotes" | "bookmarks"
>

export type ScoredPost = {
  id: string
  /** Text with trailing media links removed. */
  text: string
  createdAt: string
  impressions: number
  engagements: number
  /** engagements / impressions */
  engagementRate: number
}

export type VoiceSelection = {
  posts: ScoredPost[]
  /** Impressions floor that was applied. */
  minImpressions: number
  /** Original posts considered (after cleaning). */
  considered: number
}

export const VOICE_POST_LIMIT = 30
export const DEFAULT_MIN_IMPRESSIONS = 200
/** Fewer qualifying posts than this and the floor drops (small accounts). */
const MIN_POOL = 10
const MIN_TEXT_CHARS = 12

/** X appends t.co links for attached media; they say nothing about style. */
export function cleanPostText(text: string): string {
  return decodeXEntities(text)
    .replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/u, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
}

export const engagementsOf = (p: VoicePostInput) => p.likes + p.replies + p.reposts + p.quotes + p.bookmarks

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function selectVoicePosts(
  all: VoicePostInput[],
  opts: { limit?: number; minImpressions?: number } = {}
): VoiceSelection {
  const limit = opts.limit ?? VOICE_POST_LIMIT
  const pool = all
    .filter((p) => p.type === "original")
    .map((p) => ({ post: p, text: cleanPostText(p.text) }))
    // Mostly-media posts and bare mentions aren't useful style examples.
    .filter(({ text }) => text.length >= MIN_TEXT_CHARS && !/^@\w+$/.test(text))

  let minImpressions = opts.minImpressions ?? DEFAULT_MIN_IMPRESSIONS
  let eligible = pool.filter(({ post }) => post.impressions >= minImpressions)
  if (eligible.length < MIN_POOL && opts.minImpressions === undefined) {
    // Small account: use the median of its own originals, at least 20.
    minImpressions = Math.max(20, Math.floor(median(pool.map(({ post }) => post.impressions))))
    eligible = pool.filter(({ post }) => post.impressions >= minImpressions)
    if (eligible.length < MIN_POOL) {
      minImpressions = 1
      eligible = pool.filter(({ post }) => post.impressions >= 1)
    }
  }

  const posts = eligible
    .map(({ post, text }) => {
      const engagements = engagementsOf(post)
      return {
        id: post.id,
        text,
        createdAt: post.createdAt,
        impressions: post.impressions,
        engagements,
        engagementRate: post.impressions > 0 ? engagements / post.impressions : 0,
      }
    })
    .sort((a, b) => b.engagementRate - a.engagementRate || b.impressions - a.impressions || (a.id < b.id ? 1 : -1))
    .slice(0, limit)

  return { posts, minImpressions, considered: pool.length }
}
