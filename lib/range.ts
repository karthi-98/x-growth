import { addDays, istDateKey } from "@/lib/dates"

/** Inclusive range of IST calendar dates, as YYYY-MM-DD keys. */
export type DateRangeKeys = { from: string; to: string }

export const DEFAULT_RANGE_DAYS = 30

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** The last `days` days ending on `end` (today in IST by default). */
export function lastDays(days: number, end: string = istDateKey()): DateRangeKeys {
  return { from: addDays(end, -(days - 1)), to: end }
}

/** Number of days in an inclusive range. */
export function rangeDays({ from, to }: DateRangeKeys): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000) + 1
}

type SearchParams = Record<string, string | string[] | undefined>
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Read `?from=YYYY-MM-DD&to=YYYY-MM-DD` (IST dates). Anything malformed,
 * reversed, or ending in the future falls back to the default range.
 */
export function parseRange(
  params: SearchParams,
  today: string = istDateKey()
): DateRangeKeys & { isDefault: boolean } {
  const from = first(params.from)
  const to = first(params.to)
  if (isDateKey(from) && isDateKey(to) && from <= to && to <= today) {
    return { from, to, isDefault: false }
  }
  return { ...lastDays(DEFAULT_RANGE_DAYS, today), isDefault: true }
}
