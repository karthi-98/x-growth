/** Default display timezone; the user's choice lives in settings (lib/settings.ts). */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata"

/** @deprecated Use the timezone from settings with dateKeyIn / zonedDayStartUtc. */
export const TIME_ZONE = DEFAULT_TIME_ZONE

/** True for an IANA zone the runtime knows, e.g. "Europe/London". */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** YYYY-MM-DD for a date in the given timezone. */
export function dateKeyIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** YYYY-MM-DD for a date in IST. Prefer dateKeyIn with the settings timezone. */
export function istDateKey(date: Date = new Date()): string {
  return dateKeyIn(date, DEFAULT_TIME_ZONE)
}

/** Offset of `timeZone` from UTC at `date`, in minutes (IST = 330). */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/**
 * UTC ISO instant of local midnight starting `key` in `timeZone`. Handles DST
 * by re-checking the offset at the computed instant.
 */
export function zonedDayStartUtc(key: string, timeZone: string): string {
  const naive = Date.parse(`${key}T00:00:00Z`)
  let instant = naive - timeZoneOffsetMinutes(new Date(naive), timeZone) * 60_000
  instant = naive - timeZoneOffsetMinutes(new Date(instant), timeZone) * 60_000
  return new Date(instant).toISOString()
}

/** Shift a YYYY-MM-DD key by whole days. */
export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
