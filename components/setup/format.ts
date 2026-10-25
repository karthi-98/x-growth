// Owner: runtime workstream (docs/WORKSTREAMS.md).

/** "24 Oct, 9:30 pm" in the user's timezone. */
export function formatWhen(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(new Date(iso))
    .replace("Sept", "Sep")
}

/** "3 min ago", "2 h ago", "5 days ago". */
export function formatAgo(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
