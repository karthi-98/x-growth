/** "just now", "5m ago", "2h ago", "3d ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(diff)) return "never"
  if (diff < 60_000) return "just now"
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** "13:00" in the given timezone. */
export function formatClock(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(date)
  )
}

/** "24 Oct, 13:00" in the given timezone. */
export function formatDateTime(date: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  })
    .format(new Date(date))
    .replace("Sept", "Sep")
}
