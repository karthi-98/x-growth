import type { ApiPost, ApiRef, ApiUser } from "../contract/envelope"
import {
  storedPostTypes,
  type inspirationPosts,
  type mentions,
  type NewPost,
  type StoredPostType,
} from "../db/schema"

/*
 * Field mapping from X data to rows. The bot writes raw X API v2 objects and
 * never reshapes them, so every mapping lives here (docs/ARCHITECTURE.md
 * section 6.2). Besides the v1 envelope, two older file shapes still import
 * through an explicit path (`xstats import <file>`, `bun run db:import`):
 *
 * - Flat export: an array (or { posts: [...] }) of rows with `type`
 *   (original | reply | quote | repost), flat metrics, `conversation_id`
 *   and `referenced_tweets`.
 * - Raw X API v2 `GET /2/users/:id/tweets` pages ({ data: [...] }, an array
 *   of pages, or a bare array of API posts).
 *
 * Type comes from referenced_tweets: retweeted -> repost, replied_to ->
 * reply, quoted -> quote, otherwise original.
 */

export type NewMention = typeof mentions.$inferInsert
export type NewInspirationPost = typeof inspirationPosts.$inferInsert

type Ref = { id: string; type: string }

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

/** ISO 8601 UTC with milliseconds, so stored timestamps compare as strings. */
export const normalizeIso = (value: string) => new Date(value).toISOString()

export const postUrlFor = (id: string, handle: string | null) =>
  handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`

const refId = (refs: Ref[] | ApiRef[] | null | undefined, type: string) =>
  refs?.find((r) => r.type === type)?.id ?? null

export function typeFromRefs(refs: Ref[] | ApiRef[] | null | undefined): StoredPostType {
  const t = refs?.map((r) => r.type) ?? []
  if (t.includes("retweeted")) return "repost"
  if (t.includes("replied_to")) return "reply"
  if (t.includes("quoted")) return "quote"
  return "original"
}

const refColumns = (refs: Ref[] | ApiRef[] | null | undefined) => ({
  repliedToId: refId(refs, "replied_to"),
  quotedId: refId(refs, "quoted"),
  repostedId: refId(refs, "retweeted"),
})

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)

export type PostContext = {
  /** Envelope or file fetched_at (normalized). */
  fetchedAt: string
  handle: string | null
  accountId: string | null
}

/** An X API v2 post (envelope `data` item or raw API page item). */
export function postFromApi(p: ApiPost, ctx: PostContext): NewPost {
  const pm = p.public_metrics ?? {}
  return {
    id: p.id,
    createdAt: normalizeIso(p.created_at),
    text: p.text,
    type: typeFromRefs(p.referenced_tweets),
    url: postUrlFor(p.id, ctx.handle),
    impressions: n(p.non_public_metrics?.impression_count ?? pm.impression_count),
    likes: n(pm.like_count),
    replies: n(pm.reply_count),
    reposts: n(pm.retweet_count),
    bookmarks: n(pm.bookmark_count),
    quotes: n(pm.quote_count),
    fetchedAt: ctx.fetchedAt,
    conversationId: p.conversation_id ?? null,
    accountId: ctx.accountId,
    ...refColumns(p.referenced_tweets),
  }
}

function postFromFlat(p: FlatPost, ctx: PostContext): NewPost {
  const type = (storedPostTypes as readonly string[]).includes(p.type)
    ? (p.type as StoredPostType)
    : typeFromRefs(p.referenced_tweets)
  return {
    id: p.id,
    createdAt: normalizeIso(p.created_at),
    text: p.text,
    type,
    url: p.url ?? postUrlFor(p.id, ctx.handle),
    impressions: n(p.impressions),
    likes: n(p.likes),
    replies: n(p.replies),
    reposts: n(p.reposts),
    bookmarks: n(p.bookmarks),
    quotes: n(p.quotes),
    fetchedAt: p.fetched_at && Number.isFinite(Date.parse(p.fetched_at)) ? normalizeIso(p.fetched_at) : ctx.fetchedAt,
    conversationId: p.conversation_id ?? null,
    accountId: ctx.accountId,
    ...refColumns(p.referenced_tweets),
  }
}

const usable = (p: unknown): p is { id: string; text: string; created_at: string } =>
  !!p &&
  typeof p === "object" &&
  typeof (p as FlatPost).id === "string" &&
  typeof (p as FlatPost).text === "string" &&
  typeof (p as FlatPost).created_at === "string" &&
  Number.isFinite(Date.parse((p as FlatPost).created_at))

const isFlat = (p: unknown): p is FlatPost =>
  usable(p) && typeof (p as FlatPost).type === "string" && typeof (p as FlatPost).impressions === "number"

export type LegacyFile = {
  format: "flat" | "api-pages"
  posts: NewPost[]
  /** fetched_at from the file, or the import time. */
  fetchedAt: string
  /** `user.id` / `user.username` when the file has them (raw API exports). */
  userId: string | null
  username: string | null
}

/** Parse a pre-envelope export, or null when it has no posts we can read. */
export function parseLegacy(
  raw: unknown,
  ctx: { handle: string | null; accountId: string | null; now: Date }
): LegacyFile | null {
  const obj = !Array.isArray(raw) && raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  const user = obj?.user && typeof obj.user === "object" ? (obj.user as Record<string, unknown>) : null
  const fetchedAt =
    typeof obj?.fetched_at === "string" && Number.isFinite(Date.parse(obj.fetched_at))
      ? normalizeIso(obj.fetched_at)
      : ctx.now.toISOString()
  const userId = typeof user?.id === "string" ? user.id : null
  const username = typeof user?.username === "string" ? user.username : null
  const postCtx: PostContext = { fetchedAt, handle: ctx.handle ?? username, accountId: ctx.accountId ?? userId }

  const items: unknown[] = Array.isArray(raw) ? raw : Array.isArray(obj?.posts) ? (obj.posts as unknown[]) : [raw]
  const flat = items.length > 0 && items.every(isFlat)
  const posts = flat
    ? (items as FlatPost[]).map((p) => postFromFlat(p, postCtx))
    : items
        .flatMap((p) =>
          p && typeof p === "object" && "data" in p ? ((p as { data: unknown[] }).data ?? []) : [p]
        )
        .filter(usable)
        .map((p) => postFromApi(p as ApiPost, postCtx))
  if (posts.length === 0) return null
  return { format: flat ? "flat" : "api-pages", posts, fetchedAt, userId, username }
}

/** A post mentioning the user, for the replies inbox. */
export function mentionFromApi(p: ApiPost, users: Map<string, ApiUser>, fetchedAt: string): NewMention {
  const author = p.author_id ? users.get(p.author_id) : undefined
  const pm = p.public_metrics ?? {}
  return {
    id: p.id,
    authorId: p.author_id!,
    authorUsername: author?.username ?? null,
    authorName: author?.name ?? null,
    text: p.text,
    createdAt: normalizeIso(p.created_at),
    conversationId: p.conversation_id ?? null,
    inReplyToId: refId(p.referenced_tweets, "replied_to"),
    likes: n(pm.like_count),
    replies: n(pm.reply_count),
    reposts: n(pm.retweet_count),
    impressions: n(p.non_public_metrics?.impression_count ?? pm.impression_count),
    fetchedAt,
  }
}

/** Someone else's post saved for ideas (Phase 5). */
export function inspirationFromApi(p: ApiPost, users: Map<string, ApiUser>, fetchedAt: string): NewInspirationPost {
  const pm = p.public_metrics ?? {}
  return {
    id: p.id,
    authorId: p.author_id!,
    authorUsername: users.get(p.author_id!)?.username ?? null,
    text: p.text,
    createdAt: normalizeIso(p.created_at),
    impressions: n(pm.impression_count),
    likes: n(pm.like_count),
    replies: n(pm.reply_count),
    reposts: n(pm.retweet_count),
    bookmarks: n(pm.bookmark_count),
    fetchedAt,
  }
}

/** Larger of two X ids (snowflakes compare numerically, not as strings). */
export function maxId(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return BigInt(a) >= BigInt(b) ? a : b
}
