import { addDays } from "@/lib/dates"
import type { PostType } from "@/lib/db/schema"
import { isDateKey, type DateRangeKeys } from "@/lib/range"

/*
 * URL params and pure helpers for the Posts page. Kept free of the DB client
 * so client components can import it. Nothing here memoises dates: callers
 * pass "today" in, computed per request.
 */

/** Segments on the Posts page. Reposts are never shown. */
export const postsViews = ["posts", "replies", "all"] as const
export type PostsView = (typeof postsViews)[number]

export const POSTS_VIEW_TYPES: Record<PostsView, PostType[]> = {
  posts: ["original", "quote"],
  replies: ["reply"],
  all: ["original", "quote", "reply"],
}

export const postsSorts = ["new", "impressions"] as const
export type PostsSort = (typeof postsSorts)[number]

/** Time ranges. `all` (the default) starts at the earliest matching post. */
export const postsRanges = ["30d", "3m", "all"] as const
export type PostsRange = (typeof postsRanges)[number]

export const POSTS_RANGE_LABELS: Record<PostsRange, { short: string; long: string }> = {
  "30d": { short: "30 days", long: "Last 30 days" },
  "3m": { short: "3 months", long: "Last 3 months" },
  all: { short: "All time", long: "All time" },
}

export const POSTS_PAGE_SIZE = 25

export type PostsParams = {
  view: PostsView
  range: PostsRange
  /** Inclusive local dates from `?from=&to=`; overrides `range` when set. */
  custom: DateRangeKeys | null
  sort: PostsSort
  q: string
  page: number
}

type SearchParams = Record<string, string | string[] | undefined>
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const oneOf = <T extends string>(list: readonly T[], v: string | undefined, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback

/** Accepted spellings that map onto the canonical values. */
const SORT_ALIASES: Record<string, PostsSort> = { newest: "new", latest: "new" }

/** Both dates valid and in order, else null (fall back to `range`). */
function parseCustom(from: string | undefined, to: string | undefined): DateRangeKeys | null {
  return isDateKey(from) && isDateKey(to) && from <= to ? { from, to } : null
}

/**
 * Read `?view=&range=&from=&to=&sort=&q=&page=`; anything unknown falls back
 * to the default. Valid from/to (YYYY-MM-DD in the settings timezone,
 * inclusive) win over range.
 */
export function parsePostsParams(params: SearchParams): PostsParams {
  const page = Number.parseInt(first(params.page) ?? "", 10)
  return {
    view: oneOf(postsViews, first(params.view), "posts"),
    range: oneOf(postsRanges, first(params.range), "all"),
    custom: parseCustom(first(params.from), first(params.to)),
    sort: oneOf(postsSorts, SORT_ALIASES[first(params.sort) ?? ""] ?? first(params.sort), "new"),
    q: (first(params.q) ?? "").trim().slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

/** Shift a YYYY-MM-DD key back whole calendar months, clamping the day. */
function subtractMonths(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const target = new Date(Date.UTC(y, m - 1 - months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/**
 * First local date of a range ending today (inclusive): 30d is today and the
 * 29 days before it, 3m is e.g. 25 Jul to 24 Oct. `all` returns null; the
 * caller uses the earliest matching post.
 */
export function rangeStartKey(range: PostsRange, today: string): string | null {
  if (range === "30d") return addDays(today, -29)
  if (range === "3m") return addDays(subtractMonths(today, 3), 1)
  return null
}

/** Link for a post; falls back to the canonical status URL. */
export const postHref = (post: { id: string; url: string | null }) =>
  post.url ?? `https://x.com/i/status/${post.id}`

/** Query string for a params set, dropping defaults so URLs stay short. */
export function postsQuery(p: Partial<PostsParams>): string {
  const sp = new URLSearchParams()
  if (p.view && p.view !== "posts") sp.set("view", p.view)
  if (p.custom) {
    sp.set("from", p.custom.from)
    sp.set("to", p.custom.to)
  } else if (p.range && p.range !== "all") {
    sp.set("range", p.range)
  }
  if (p.sort && p.sort !== "new") sp.set("sort", p.sort)
  if (p.q) sp.set("q", p.q)
  if (p.page && p.page > 1) sp.set("page", String(p.page))
  const s = sp.toString()
  return s ? `?${s}` : ""
}
