import { addDays } from "@/lib/dates"

/*
 * Day, weekday and hour bucketing in the settings timezone. Stored
 * timestamps are UTC ISO strings; a calendar day is [local midnight, next
 * local midnight), so DST days are 23 or 25 hours long and still bucket
 * correctly. Pure and client-safe (no DB or Next imports).
 */

/** Weekday labels, Monday first (index 0). */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

// Building an Intl.DateTimeFormat is slow; bucketing thousands of posts
// reuses one per timezone.
const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string) {
  let f = partsFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      weekday: "short",
    })
    partsFormatters.set(timeZone, f)
  }
  return f
}

export type ZonedParts = {
  /** YYYY-MM-DD local date. */
  key: string
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number
  /** 0-23 local hour. */
  hour: number
}

/** Local date, weekday and hour of an instant in `timeZone`. */
export function zonedParts(at: Date | string | number, timeZone: string): ZonedParts {
  const date = at instanceof Date ? at : new Date(at)
  const out: Record<string, string> = {}
  for (const p of partsFormatter(timeZone).formatToParts(date)) out[p.type] = p.value
  return {
    key: `${out.year}-${out.month}-${out.day}`,
    weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
    // Some engines print midnight as "24" even with h23.
    hour: Number(out.hour) % 24,
  }
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

/** Offset of `timeZone` from UTC at `ms`, in minutes (timeZoneOffsetMinutes with a cached formatter). */
function offsetMinutes(ms: number, timeZone: string): number {
  let f = offsetFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    offsetFormatters.set(timeZone, f)
  }
  const out: Record<string, number> = {}
  for (const p of f.formatToParts(ms)) out[p.type] = Number(p.value)
  const asUtc = Date.UTC(out.year, out.month - 1, out.day, out.hour % 24, out.minute, out.second)
  return Math.round((asUtc - ms) / 60_000)
}

/**
 * UTC ms of local midnight starting `key` in `timeZone`. Same result as
 * zonedDayStartUtc in lib/dates.ts (the tests hold them equal), with cached
 * formatters so a long range of days stays fast.
 */
export function dayStartMs(key: string, timeZone: string): number {
  const naive = Date.parse(`${key}T00:00:00Z`)
  const guess = naive - offsetMinutes(naive, timeZone) * 60_000
  return naive - offsetMinutes(guess, timeZone) * 60_000
}

/** Today's YYYY-MM-DD in `timeZone`. */
export const todayIn = (timeZone: string, now: Date = new Date()) => zonedParts(now, timeZone).key

export type ZonedDays = {
  /** Every local date from `from` to `to`, inclusive. */
  keys: string[]
  /** UTC ISO instant of local midnight starting `from` (inclusive bound). */
  start: string
  /** UTC ISO instant of local midnight after `to` (exclusive bound). */
  end: string
  /** UTC ms of each day's local midnight, plus the end bound (keys.length + 1 entries). */
  bounds: number[]
  /** Index into `keys` of the local day containing an instant, or -1 outside. */
  indexOf(at: Date | string | number): number
}

/**
 * The local days of an inclusive YYYY-MM-DD range in `timeZone`, with the
 * UTC bounds to query and a binary-search bucketer for timestamps.
 */
export function zonedDays(from: string, to: string, timeZone: string): ZonedDays {
  const keys: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d)
  const bounds = [...keys, addDays(to, 1)].map((k) => dayStartMs(k, timeZone))
  const last = keys.length

  return {
    keys,
    start: new Date(bounds[0]).toISOString(),
    end: new Date(bounds[last]).toISOString(),
    bounds,
    indexOf(at) {
      const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at)
      if (!(ms >= bounds[0] && ms < bounds[last])) return -1
      let lo = 0
      let hi = last - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (bounds[mid] <= ms) lo = mid
        else hi = mid - 1
      }
      return lo
    },
  }
}

/** Monday on or before a YYYY-MM-DD key. */
export function weekStart(key: string): string {
  const day = new Date(`${key}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(key, -((day + 6) % 7))
}
