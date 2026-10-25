/** "24 Oct, 9:30 pm" in the user's timezone (settings.timeZone). */
export function formatWhen(iso: string, timeZone: string): string {
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

/** Public URL of someone's post. */
export const statusUrl = (id: string, username?: string | null) =>
  username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/status/${id}`
