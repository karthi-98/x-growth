import { and, desc, gte, inArray, lt, lte, sql } from "drizzle-orm"
import { connection } from "next/server"

import { addDays, dateKeyIn, zonedDayStartUtc } from "@/lib/dates"
import { db } from "@/lib/db/client"
import { posts, type DashboardPost } from "@/lib/db/schema"
import {
  POSTS_PAGE_SIZE,
  POSTS_VIEW_TYPES,
  rangeStartKey,
  type PostsParams,
} from "@/lib/posts-params"

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export type PostsPage = {
  rows: DashboardPost[]
  total: number
  page: number
  pageCount: number
  /** Local date keys for the label; null `from` when nothing matches the type. */
  range: { from: string | null; to: string }
}

/**
 * One page of posts for the URL params, with dates in `timeZone` (the
 * settings timezone). Fully dynamic: `connection()` opts the caller out of
 * prerendering and caching, and "now", "today" and the all-time start
 * (MIN created_at) are all read here, per request.
 */
export async function getPostsPage(params: PostsParams, timeZone: string): Promise<PostsPage> {
  await connection()
  const now = new Date()
  const today = dateKeyIn(now, timeZone)
  const types = POSTS_VIEW_TYPES[params.view]
  const byType = inArray(posts.type, types)

  const { custom } = params
  const startKey = custom ? custom.from : rangeStartKey(params.range, today)
  let from: string | null = startKey
  if (!startKey) {
    // All time: earliest non-repost post of the selected type(s).
    const [{ min }] = await db
      .select({ min: sql<string | null>`min(${posts.createdAt})` })
      .from(posts)
      .where(byType)
    from = min ? dateKeyIn(new Date(min), timeZone) : null
  }

  const where = and(
    byType,
    startKey ? gte(posts.createdAt, zonedDayStartUtc(startKey, timeZone)) : undefined,
    // Custom `to` is inclusive: up to the end of that local day.
    custom ? lt(posts.createdAt, zonedDayStartUtc(addDays(custom.to, 1), timeZone)) : undefined,
    // Never past now, so a future `to` reads as today.
    lte(posts.createdAt, now.toISOString()),
    params.q
      ? sql`lower(${posts.text}) like ${`%${escapeLike(params.q.toLowerCase())}%`} escape '\\'`
      : undefined
  )
  // Label end: cap at today, unless the whole custom range is in the future.
  const to = custom && (custom.to < today || custom.from > today) ? custom.to : today

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(posts)
    .where(where)

  const count = Number(total ?? 0)
  const pageCount = Math.max(1, Math.ceil(count / POSTS_PAGE_SIZE))
  const page = Math.min(params.page, pageCount)

  const order =
    params.sort === "impressions"
      ? [desc(posts.impressions), desc(posts.createdAt)]
      : [desc(posts.createdAt), desc(posts.id)]

  // The type filter excludes reposts, so every row is a dashboard type.
  const rows = (await db
    .select()
    .from(posts)
    .where(where)
    .orderBy(...order)
    .limit(POSTS_PAGE_SIZE)
    .offset((page - 1) * POSTS_PAGE_SIZE)) as DashboardPost[]

  return { rows, total: count, page, pageCount, range: { from, to } }
}
