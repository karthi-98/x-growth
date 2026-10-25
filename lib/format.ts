const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const full = new Intl.NumberFormat("en-US")
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
})
const rate = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const formatCompact = (n: number) => compact.format(n)
export const formatNumber = (n: number) => full.format(n)
export const formatPercent = (ratio: number) => percent.format(ratio)
/** "4.2%" for a 0-1 ratio such as an engagement rate (no sign). */
export const formatRate = (ratio: number) => rate.format(ratio)

// Newer ICU abbreviates September as "Sept"; keep three-letter months.

/** "24 Oct" from a YYYY-MM-DD key. */
export function formatDayKey(key: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00Z`)).replace("Sept", "Sep")
}

const postDateFormatters = new Map<string, Intl.DateTimeFormat>()

/** "24 Oct, 9:30 pm" in `timeZone` (the settings timezone) from an ISO timestamp. */
export function formatPostDate(iso: string, timeZone: string) {
  let f = postDateFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    })
    postDateFormatters.set(timeZone, f)
  }
  return f.format(new Date(iso)).replace("Sept", "Sep")
}

/**
 * Short name for a timezone at an instant: "IST", "EDT", "BST", "UTC", or
 * "GMT+9" where no letter abbreviation exists. Tries a few English locales
 * because each only knows the abbreviations local to it.
 */
export function timeZoneAbbr(timeZone: string, at: Date = new Date()) {
  let fallback = timeZone
  for (const locale of ["en-US", "en-GB", "en-IN", "en-AU"]) {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value
    if (!name) continue
    if (!/^(GMT|UTC)[+-]/.test(name)) return name
    if (fallback === timeZone) fallback = name
  }
  return fallback
}

/** "IST (Asia/Kolkata)", or just "UTC" when the two match. */
export function formatTimeZone(timeZone: string, at: Date = new Date()) {
  const abbr = timeZoneAbbr(timeZone, at)
  return abbr === timeZone ? timeZone : `${abbr} (${timeZone})`
}

/** "25 Sep – 24 Oct 2026", "24 Oct 2026", or "28 Dec 2025 – 3 Jan 2026". */
export function formatRangeLabel(from: string, to: string) {
  const year = (key: string) => key.slice(0, 4)
  if (from === to) return `${formatDayKey(from)} ${year(from)}`
  if (year(from) === year(to)) {
    return `${formatDayKey(from)} \u2013 ${formatDayKey(to)} ${year(to)}`
  }
  return `${formatDayKey(from)} ${year(from)} \u2013 ${formatDayKey(to)} ${year(to)}`
}
