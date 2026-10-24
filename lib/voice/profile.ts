import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { posts } from "@/lib/db/schema"
import { paths } from "@/lib/paths"
import { readSettings } from "@/lib/settings"

import { selectVoicePosts, VOICE_POST_LIMIT } from "./select"
import { describeVoice, topThemes, voiceStats, type VoiceStats } from "./style"

/*
 * The user's voice profile: a short style summary plus their best original
 * posts, built locally from the posts table and saved as JSON in the data
 * folder. Every AI writing prompt uses it (lib/ai/prompts.ts). Rebuilt on
 * demand from Settings, and automatically when it is a week old.
 */

export type VoiceExample = {
  id: string
  text: string
  createdAt: string
  impressions: number
  engagementRate: number
}

export type VoiceProfile = {
  version: 1
  builtAt: string
  handle: string | null
  summary: string[]
  themes: string[]
  stats: VoiceStats
  minImpressions: number
  /** Original posts that could be examples. */
  originalsConsidered: number
  examples: VoiceExample[]
}

export const VOICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function readVoiceProfile(): VoiceProfile | null {
  if (!existsSync(paths.voiceProfile)) return null
  try {
    const parsed = JSON.parse(readFileSync(paths.voiceProfile, "utf8")) as VoiceProfile
    return parsed?.version === 1 && Array.isArray(parsed.examples) ? parsed : null
  } catch {
    return null
  }
}

export function isVoiceProfileStale(profile: VoiceProfile | null, now: Date = new Date()): boolean {
  if (!profile) return true
  const built = Date.parse(profile.builtAt)
  return !Number.isFinite(built) || now.getTime() - built > VOICE_MAX_AGE_MS
}

/** Rebuild from the posts table and save. */
export async function buildVoiceProfile(now: Date = new Date()): Promise<VoiceProfile> {
  const [settings, rows] = await Promise.all([
    readSettings(),
    db
      .select({
        id: posts.id,
        text: posts.text,
        type: posts.type,
        createdAt: posts.createdAt,
        impressions: posts.impressions,
        likes: posts.likes,
        replies: posts.replies,
        reposts: posts.reposts,
        quotes: posts.quotes,
        bookmarks: posts.bookmarks,
      })
      .from(posts)
      .where(eq(posts.type, "original")),
  ])

  const selection = selectVoicePosts(rows, { limit: VOICE_POST_LIMIT })
  const texts = selection.posts.map((p) => p.text)
  const stats = voiceStats(texts)
  const profile: VoiceProfile = {
    version: 1,
    builtAt: now.toISOString(),
    handle: settings.handle,
    summary: describeVoice(stats),
    themes: topThemes(texts),
    stats,
    minImpressions: selection.minImpressions,
    originalsConsidered: selection.considered,
    examples: selection.posts.map((p) => ({
      id: p.id,
      text: p.text,
      createdAt: p.createdAt,
      impressions: p.impressions,
      engagementRate: Math.round(p.engagementRate * 10_000) / 10_000,
    })),
  }

  mkdirSync(path.dirname(paths.voiceProfile), { recursive: true })
  writeFileSync(paths.voiceProfile, JSON.stringify(profile, null, 2))
  return profile
}

/** The saved profile, rebuilt first when it's missing or a week old. */
export async function getVoiceProfile(now: Date = new Date()): Promise<VoiceProfile> {
  const saved = readVoiceProfile()
  if (saved && !isVoiceProfileStale(saved, now)) return saved
  try {
    return await buildVoiceProfile(now)
  } catch (err) {
    // A stale profile still beats none; writing help shouldn't fail on this.
    if (saved) return saved
    throw err
  }
}
