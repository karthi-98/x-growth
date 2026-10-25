import { addDays } from "@/lib/dates"
import type { StoredPostType } from "@/lib/db/schema"
import { weekStart, zonedDays } from "@/lib/insights/zoned"

/*
 * Posting consistency over a range of local days: averages, active days,
 * streaks and a weekly series. "Posts" are originals and quotes; replies
 * are counted alongside but never extend a streak.
 */

export type WeekCount = {
  /** Monday of the week (YYYY-MM-DD). */
  week: string
  posts: number
  replies: number
  /** Days of this week inside the range (7 except at the edges). */
  days: number
}

export type Consistency = {
  days: number
  posts: number
  replies: number
  postsPerDay: number
  postsPerWeek: number
  repliesPerDay: number
  /** Days in the range with at least one post. */
  activeDays: number
  /** Consecutive days with a post, ending today (or yesterday while today has none yet). */
  currentStreak: number
  /** Longest run of posting days inside the range. */
  longestStreak: { days: number; from: string; to: string } | null
  weeks: WeekCount[]
}

const isPost = (type: StoredPostType) => type === "original" || type === "quote"

/**
 * @param rows posts and replies created inside [from, to] (others are ignored)
 * @param postDays every local day with a post, any date (for the current streak)
 */
export function consistency(
  rows: { createdAt: string; type: StoredPostType }[],
  postDays: Set<string>,
  from: string,
  to: string,
  today: string,
  timeZone: string
): Consistency {
  const span = zonedDays(from, to, timeZone)
  const perDay = span.keys.map(() => ({ posts: 0, replies: 0 }))
  for (const r of rows) {
    const i = span.indexOf(r.createdAt)
    if (i < 0) continue
    if (isPost(r.type)) perDay[i].posts += 1
    else if (r.type === "reply") perDay[i].replies += 1
  }

  const days = span.keys.length
  const posts = perDay.reduce((a, d) => a + d.posts, 0)
  const replies = perDay.reduce((a, d) => a + d.replies, 0)

  let longest: Consistency["longestStreak"] = null
  let runStart = -1
  perDay.forEach((d, i) => {
    if (d.posts === 0) {
      runStart = -1
      return
    }
    if (runStart < 0) runStart = i
    const length = i - runStart + 1
    if (!longest || length > longest.days) {
      longest = { days: length, from: span.keys[runStart], to: span.keys[i] }
    }
  })

  let currentStreak = 0
  let day = postDays.has(today) ? today : addDays(today, -1)
  while (postDays.has(day)) {
    currentStreak += 1
    day = addDays(day, -1)
  }

  const weeks: WeekCount[] = []
  span.keys.forEach((key, i) => {
    const week = weekStart(key)
    let w = weeks[weeks.length - 1]
    if (!w || w.week !== week) {
      w = { week, posts: 0, replies: 0, days: 0 }
      weeks.push(w)
    }
    w.posts += perDay[i].posts
    w.replies += perDay[i].replies
    w.days += 1
  })

  return {
    days,
    posts,
    replies,
    postsPerDay: days ? posts / days : 0,
    postsPerWeek: days ? (posts / days) * 7 : 0,
    repliesPerDay: days ? replies / days : 0,
    activeDays: perDay.filter((d) => d.posts > 0).length,
    currentStreak,
    longestStreak: longest,
    weeks,
  }
}
