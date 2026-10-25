import { addDays } from "@/lib/dates"
import { rangeStartKey, type PostsRange } from "@/lib/posts-params"
import { DEFAULT_RANGE_DAYS, isDateKey, type DateRangeKeys } from "@/lib/range"

/*
 * Carry a date range between the dashboard (?from&to, default last 30 days)
 * and /posts (?range=30d|3m|all, or ?from&to which wins over range). Pure and
 * client-safe; callers pass "today" (in the settings timezone) and the
 * earliest data date.
 */

type Params = { get(name: string): string | null }

/**
 * /posts params for a dashboard range: an exact preset match sends only
 * range= (so /posts highlights that segment); anything else sends from/to.
 */
export function postsRangeParams(
  range: DateRangeKeys,
  today: string,
  minKey: string | null
): Record<string, string> {
  if (range.to === today) {
    const preset = (["30d", "3m"] as PostsRange[]).find((r) => rangeStartKey(r, today) === range.from)
    if (preset) return { range: preset }
    if (minKey && range.from <= minKey) return { range: "all" }
  }
  return { from: range.from, to: range.to }
}

/**
 * Dashboard range for /posts params, or null for the dashboard default.
 * from/to carry over as is; range=3m|all map to their dates; 30d is the
 * dashboard default already.
 */
export function dashboardRangeFromPosts(
  params: Params,
  today: string,
  minKey: string | null
): DateRangeKeys | null {
  const from = params.get("from")
  const to = params.get("to")
  if (isDateKey(from) && isDateKey(to) && from <= to) return { from, to: to > today ? today : to }
  const range = params.get("range")
  if (range === "3m") return { from: rangeStartKey("3m", today)!, to: today }
  if (range === "all" && minKey) return { from: minKey, to: today }
  return null
}

const withQuery = (path: string, query: Record<string, string>) => {
  const qs = new URLSearchParams(query).toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * Href for a nav item given the current page and its params. Staying on the
 * same page keeps the current query; switching pages carries the range.
 */
export function navHref(
  target: "/" | "/posts",
  pathname: string,
  params: Params & { toString(): string },
  today: string,
  minKey: string | null
): string {
  if (target === pathname) {
    const qs = params.toString()
    return qs ? `${target}?${qs}` : target
  }
  if (target === "/posts") {
    const from = params.get("from")
    const to = params.get("to")
    // Only carry an explicit dashboard range; mirror the dashboard's own
    // validation (to must not be in the future).
    if (!(isDateKey(from) && isDateKey(to) && from <= to && to <= today)) return target
    return withQuery(target, postsRangeParams({ from, to }, today, minKey))
  }
  const range = dashboardRangeFromPosts(params, today, minKey)
  const isDefault = range && range.to === today && range.from === addDays(today, -(DEFAULT_RANGE_DAYS - 1))
  return range && !isDefault ? withQuery(target, { from: range.from, to: range.to }) : target
}