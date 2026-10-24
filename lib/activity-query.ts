import { and, eq, gte, lt, sql } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"

import { addDays } from "@/lib/dates"
import { db } from "@/lib/db/client"
import { posts } from "@/lib/db/schema"
import { rangeDays } from "@/lib/range"

/** One IST calendar day: posts = originals + quotes, replies = replies Thor made. */
export type ActivityDay = { date: string; posts: number; replies: number }

export type ActivityData = {
  range: { from: string; to: string }
  days: ActivityDay[]
  totals: { posts: number; replies: number }
  /** False until any reply-type post has been imported (any date). */
  hasReplies: boolean
}

/** UTC ISO instant for 00:00 IST on a YYYY-MM-DD key (matches lib/queries.ts). */
const istMidnight = (key: string) =>
  new Date(`${key}T00:00:00+05:30`).toISOString()

/** IST calendar day of a stored UTC ISO created_at. */
const istDay = sql<string>`date(${posts.createdAt}, '+5 hours', '+30 minutes')`

async function loadActivityData(from: string, to: string): Promise<ActivityData> {
  // The DB changes outside the build, so read it per request.
  await connection()

  const rows = await db
    .select({
      date: istDay,
      posts: sql<number>`sum(case when ${posts.type} in ('original', 'quote') then 1 else 0 end)`,
      replies: sql<number>`sum(case when ${posts.type} = 'reply' then 1 else 0 end)`,
    })
    .from(posts)
    .where(
      and(
        gte(posts.createdAt, istMidnight(from)),
        lt(posts.createdAt, istMidnight(addDays(to, 1)))
      )
    )
    .groupBy(istDay)

  const byDate = new Map(rows.map((r) => [r.date, r]))
  const days = Array.from({ length: rangeDays({ from, to }) }, (_, i) => {
    const date = addDays(from, i)
    const r = byDate.get(date)
    return { date, posts: Number(r?.posts ?? 0), replies: Number(r?.replies ?? 0) }
  })

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

/** Per-day post and reply counts over an inclusive IST range, zero-filled. */
export const getActivityData = cache(loadActivityData)
