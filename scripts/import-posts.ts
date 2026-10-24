/**
 * Import X posts from a saved JSON file into data/x-stats.db.
 *
 *   bun run db:import data/imports/posts-since-2026-06-01.json [data/imports/daily-since-2026-06-01.json]
 *
 * Accepts two shapes:
 * - Flat export: an array (or { posts: [...] }) of rows with `type`
 *   (original | reply | quote | repost), flat metrics, `conversation_id`
 *   and `referenced_tweets`.
 * - Raw X API v2 `GET /2/users/:id/tweets` pages ({ data: [...] }, an array
 *   of pages, or a bare array of API posts). Type comes from
 *   referenced_tweets: retweeted -> repost, replied_to -> reply,
 *   quoted -> quote, otherwise original.
 *
 * Idempotent:
 * - Upserts posts by id. On conflict it refreshes every column (created_at,
 *   text, type, url, metrics, fetched_at, reference ids) when the incoming
 *   fetched_at is newer or equal. conversation_id is only overwritten when
 *   the file has one, since some exports leave it blank.
 * - Deletes seed rows (id "sample-..." or text "[Sample]..."); when any
 *   existed, also clears daily_stats, which the seed writes together.
 * - Rebuilds daily_stats for every IST date from the file's first to last
 *   post date (zero-filled), summing stored originals, replies and quotes.
 *   Reposts are stored but never counted.
 *
 * With a daily file (per-day IST sums from the same export), prints the
 * days whose rebuilt totals differ from it.
 */
import { readFileSync } from "node:fs"
import { and, gte, inArray, like, lt, ne, or, sql } from "drizzle-orm"

import { addDays, istDateKey } from "../lib/dates"
import { db } from "../lib/db/client"
import {
  dailyStats,
  posts,
  storedPostTypes,
  type NewDailyStat,
  type NewPost,
  type StoredPostType,
} from "../lib/db/schema"

type Ref = { id: string; type: string }

type ApiPost = {
  id: string
  text: string
  created_at: string
  referenced_tweets?: Ref[]
  conversation_id?: string
  public_metrics?: Record<string, number>
  non_public_metrics?: Record<string, number>
}

type FlatPost = {
  id: string
  created_at: string
  text: string
  type: string
  url?: string
  impressions?: number
  likes?: number
  replies?: number
  reposts?: number
  bookmarks?: number
  quotes?: number
  fetched_at?: string
  conversation_id?: string | null
  referenced_tweets?: Ref[] | null
}

type DailyRow = {
  date: string
  posts: number
  impressions: number
  likes: number
  replies: number
  reposts: number
  bookmarks: number
}

const [file, dailyFile] = process.argv.slice(2)
if (!file) {
  console.error("Usage: bun run db:import <posts.json> [daily.json]")
  process.exit(1)
}

const raw = JSON.parse(readFileSync(file, "utf8"))
const fileFetchedAt: string =
  (!Array.isArray(raw) && typeof raw.fetched_at === "string" && raw.fetched_at) ||
  new Date().toISOString()
const handle: string =
  (!Array.isArray(raw) && raw.user?.username) || "designwkarthick"

const isFlat = (p: unknown): p is FlatPost =>
  !!p &&
  typeof p === "object" &&
  typeof (p as FlatPost).type === "string" &&
  typeof (p as FlatPost).impressions === "number"

const refId = (refs: Ref[] | null | undefined, type: string) =>
  refs?.find((r) => r.type === type)?.id ?? null

const typeFromRefs = (refs: Ref[] | null | undefined): StoredPostType => {
  const t = refs?.map((r) => r.type) ?? []
  if (t.includes("retweeted")) return "repost"
  if (t.includes("replied_to")) return "reply"
  if (t.includes("quoted")) return "quote"
  return "original"
}

const refColumns = (refs: Ref[] | null | undefined) => ({
  repliedToId: refId(refs, "replied_to"),
  quotedId: refId(refs, "quoted"),
  repostedId: refId(refs, "retweeted"),
})

function fromFlat(p: FlatPost): NewPost {
  const type = (storedPostTypes as readonly string[]).includes(p.type)
    ? (p.type as StoredPostType)
    : typeFromRefs(p.referenced_tweets)
  return {
    id: p.id,
    createdAt: new Date(p.created_at).toISOString(),
    text: p.text,
    type,
    url: p.url ?? `https://x.com/${handle}/status/${p.id}`,
    impressions: p.impressions ?? 0,
    likes: p.likes ?? 0,
    replies: p.replies ?? 0,
    reposts: p.reposts ?? 0,
    bookmarks: p.bookmarks ?? 0,
    quotes: p.quotes ?? 0,
    fetchedAt: p.fetched_at ?? fileFetchedAt,
    conversationId: p.conversation_id ?? null,
    ...refColumns(p.referenced_tweets),
  }
}

function fromApi(p: ApiPost): NewPost {
  const pm = p.public_metrics ?? {}
  const npm = p.non_public_metrics ?? {}
  return {
    id: p.id,
    createdAt: new Date(p.created_at).toISOString(),
    text: p.text,
    type: typeFromRefs(p.referenced_tweets),
    url: `https://x.com/${handle}/status/${p.id}`,
    impressions: npm.impression_count ?? pm.impression_count ?? 0,
    likes: pm.like_count ?? 0,
    replies: pm.reply_count ?? 0,
    reposts: pm.retweet_count ?? 0,
    bookmarks: pm.bookmark_count ?? 0,
    quotes: pm.quote_count ?? 0,
    fetchedAt: fileFetchedAt,
    conversationId: p.conversation_id ?? null,
    ...refColumns(p.referenced_tweets),
  }
}

const items: unknown[] = Array.isArray(raw)
  ? raw
  : Array.isArray(raw?.posts)
    ? raw.posts
    : [raw]
const flat = items.length > 0 && items.every(isFlat)
const rows: NewPost[] = flat
  ? (items as FlatPost[]).map(fromFlat)
  : items
      .flatMap((p) =>
        p && typeof p === "object" && "data" in p
          ? ((p as { data: ApiPost[] }).data ?? [])
          : [p as ApiPost]
      )
      .map(fromApi)

const byId = new Map(rows.map((r) => [r.id, r]))
const unique = [...byId.values()]
if (unique.length === 0) {
  console.error("No posts found in", file)
  process.exit(1)
}

const fileDates = unique.map((r) => istDateKey(new Date(r.createdAt))).sort()
const first = fileDates[0]
const last = fileDates.at(-1)!
const dates: string[] = []
for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d)
const istMidnight = (key: string) => new Date(`${key}T00:00:00+05:30`).toISOString()

const emptyDay = (date: string): NewDailyStat => ({
  date,
  posts: 0,
  impressions: 0,
  likes: 0,
  replies: 0,
  reposts: 0,
  bookmarks: 0,
})

const result = await db.transaction(async (tx) => {
  const samples = await tx
    .delete(posts)
    .where(or(like(posts.id, "sample-%"), like(posts.text, "[Sample]%")))
    .returning({ id: posts.id })
  if (samples.length > 0) await tx.delete(dailyStats)

  const existing = new Map<string, string>()
  const ids = unique.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 500) {
    const found = await tx
      .select({ id: posts.id, type: posts.type })
      .from(posts)
      .where(inArray(posts.id, ids.slice(i, i + 500)))
    found.forEach((f) => existing.set(f.id, f.type))
  }

  for (let i = 0; i < unique.length; i += 100) {
    await tx
      .insert(posts)
      .values(unique.slice(i, i + 100))
      .onConflictDoUpdate({
        target: posts.id,
        set: {
          createdAt: sql`excluded.created_at`,
          text: sql`excluded.text`,
          type: sql`excluded.type`,
          url: sql`excluded.url`,
          impressions: sql`excluded.impressions`,
          likes: sql`excluded.likes`,
          replies: sql`excluded.replies`,
          reposts: sql`excluded.reposts`,
          bookmarks: sql`excluded.bookmarks`,
          quotes: sql`excluded.quotes`,
          fetchedAt: sql`excluded.fetched_at`,
          conversationId: sql`coalesce(excluded.conversation_id, ${posts.conversationId})`,
          repliedToId: sql`excluded.replied_to_id`,
          quotedId: sql`excluded.quoted_id`,
          repostedId: sql`excluded.reposted_id`,
        },
        // Never overwrite fresher metrics with an older file.
        setWhere: sql`excluded.fetched_at >= ${posts.fetchedAt}`,
      })
  }

  // Count stored rows whose type changed in this import.
  const typeChanges: string[] = []
  const known = [...existing.keys()]
  for (let i = 0; i < known.length; i += 500) {
    const now = await tx
      .select({ id: posts.id, type: posts.type })
      .from(posts)
      .where(inArray(posts.id, known.slice(i, i + 500)))
    for (const r of now) {
      const before = existing.get(r.id)
      if (before !== r.type) typeChanges.push(`${before} -> ${r.type}`)
    }
  }

  // Rebuild daily_stats from every stored non-repost post on the covered dates.
  const stored = await tx
    .select()
    .from(posts)
    .where(
      and(
        ne(posts.type, "repost"),
        gte(posts.createdAt, istMidnight(first)),
        lt(posts.createdAt, istMidnight(addDays(last, 1)))
      )
    )
  const totals = new Map(dates.map((d) => [d, emptyDay(d)]))
  for (const p of stored) {
    const t = totals.get(istDateKey(new Date(p.createdAt)))
    if (!t) continue
    t.posts! += 1
    t.impressions! += p.impressions
    t.likes! += p.likes
    t.replies! += p.replies
    t.reposts! += p.reposts
    t.bookmarks! += p.bookmarks
  }
  for (let i = 0; i < dates.length; i += 200) {
    await tx.delete(dailyStats).where(inArray(dailyStats.date, dates.slice(i, i + 200)))
  }
  const dayRows = [...totals.values()]
  for (let i = 0; i < dayRows.length; i += 200) {
    await tx.insert(dailyStats).values(dayRows.slice(i, i + 200))
  }
  return { samples: samples.length, existing: existing.size, typeChanges, totals }
})

const count = (t: StoredPostType) => unique.filter((r) => r.type === t).length
console.log(
  `Read ${unique.length} posts (${flat ? "flat export" : "X API pages"}): ${count("original")} original, ${count("reply")} reply, ${count("quote")} quote, ${count("repost")} repost; ${fileDates[0]} to ${last} IST.`
)
console.log(
  `Inserted ${unique.length - result.existing}, updated ${result.existing} (rows fetched later than this file are kept). Removed ${result.samples} sample posts${result.samples ? " and all sample daily_stats" : ""}.`
)
const changeCounts = new Map<string, number>()
for (const c of result.typeChanges) changeCounts.set(c, (changeCounts.get(c) ?? 0) + 1)
console.log(
  `Type changed on ${result.typeChanges.length} rows${changeCounts.size ? ": " + [...changeCounts].map(([k, n]) => `${k} ${n}`).join(", ") : ""}.`
)
const counted = [...result.totals.values()]
const total = (k: keyof DailyRow) => counted.reduce((a, d) => a + Number(d[k as keyof NewDailyStat] ?? 0), 0)
console.log(
  `Rebuilt daily_stats for ${dates.length} dates. Totals excl. reposts: posts ${total("posts")}, impressions ${total("impressions")}, likes ${total("likes")}, replies ${total("replies")}, reposts ${total("reposts")}, bookmarks ${total("bookmarks")}.`
)

if (dailyFile) {
  const daily: DailyRow[] = JSON.parse(readFileSync(dailyFile, "utf8"))
  const keys = ["posts", "impressions", "likes", "replies", "reposts", "bookmarks"] as const
  const diffs: string[] = []
  for (const d of daily) {
    const mine = result.totals.get(d.date)
    if (!mine) {
      if (keys.some((k) => d[k] !== 0)) diffs.push(`${d.date}: in daily file only (${d.posts} posts)`)
      continue
    }
    const delta = keys
      .filter((k) => Number(mine[k] ?? 0) !== d[k])
      .map((k) => `${k} ${mine[k]} vs ${d[k]}`)
    if (delta.length) diffs.push(`${d.date}: ${delta.join(", ")}`)
  }
  console.log(
    diffs.length
      ? `Daily file differs on ${diffs.length} days (db vs file):\n  ${diffs.join("\n  ")}`
      : `Daily file matches daily_stats on all ${daily.length} days (days outside the post range are zero).`
  )
}
