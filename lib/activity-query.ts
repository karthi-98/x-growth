import { and, eq, gte, lt } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { db } from "@/lib/db/client"
import { posts } from "@/lib/db/schema"
import { countActivityByDay, type ActivityDay } from "@/lib/insights/daily"
import { zonedDays } from "@/lib/insights/zoned"

/** One local calendar day: posts = originals + quotes, replies = replies Thor made. */
export type { ActivityDay }

export type ActivityData = {
  range: { from: string; to: string }
  days: ActivityDay[]
  totals: { posts: number; replies: number }
  /** False until any reply-type post has been imported (any date). */
  hasReplies: boolean
}

async function loadActivityData(from: string, to: string, timeZone: string): Promise<ActivityData> {
  // The DB changes outside the build, so read it per request.
  await connection()

  const { start, end } = zonedDays(from, to, timeZone)
  const rows = await db
    .select({ createdAt: posts.createdAt, type: posts.type })
    .from(posts)
    .where(and(gte(posts.createdAt, start), lt(posts.createdAt, end)))

  const days = countActivityByDay(rows, from, to, timeZone)

  const totals = days.reduce(
    (acc, d) => ({ posts: acc.posts + d.posts, replies: acc.replies + d.replies }),
    { posts: 0, replies: 0 }
  )

  const [any] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.type, "reply"))
    .limit(1)

  return { range: { from, to }, days, totals, hasReplies: Boolean(any) }
}

/** Per-day post and reply counts over an inclusive local-date range, zero-filled. */
export const getActivityData = cache(loadActivityData)
