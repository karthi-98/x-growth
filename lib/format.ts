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

export const formatCompact = (n: number) => compact.format(n)
export const formatNumber = (n: number) => full.format(n)
export const formatPercent = (ratio: number) => percent.format(ratio)

// Newer ICU abbreviates September as "Sept"; keep three-letter months.

/** "24 Oct" from a YYYY-MM-DD key. */
export function formatDayKey(key: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00Z`)).replace("Sept", "Sep")
}

/** "24 Oct, 9:30 pm" in IST from an ISO timestamp. */
export function formatPostDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso)).replace("Sept", "Sep")
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
