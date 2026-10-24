import { formatClock, formatDateTime, timeAgo } from "@/lib/sync/format"
import type { SyncStatusInfo } from "@/lib/sync/status"

export type HealthTone = "ok" | "warn" | "error" | "muted"

export type HealthCopy = {
  tone: HealthTone
  /** Short label for the top-bar chip. */
  chip: string
  /** One or two sentences for the tooltip and Settings. */
  detail: string
  /** Next reminder as "13:00", or null when none are set. */
  next: string | null
}

const PAUSED_HINT =
  "Grok Bot may pause routines after a quiet stretch: open Grok Bot and resume the X Growth routines."

/** Ends with a full stop exactly once. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** Wording shared by the top-bar chip and Settings > Sync. */
export function healthCopy(s: SyncStatusInfo, now: Date): HealthCopy {
  const ago = s.syncedAt ? timeAgo(s.syncedAt, now) : null
  const next = s.nextReminderAt ? formatClock(s.nextReminderAt, s.timeZone) : null
  const upTo = s.syncedAt ? ` Data is complete up to ${formatDateTime(s.syncedAt, s.timeZone)}.` : ""
  const nextText = next ? ` Next reminder at ${next}.` : " No reminder times are set."
  switch (s.health) {
    case "never":
      return {
        tone: "muted",
        chip: "Not synced yet",
        detail: "Ask Grok Bot to install X Growth and run the first import (backfill).",
        next,
      }
    case "failing":
      return {
        tone: "error",
        chip: "Last sync failed",
        detail: `${sentence(`The last import failed: ${s.lastRun?.error ?? "unknown error"}`)}${upTo}${s.stale ? ` ${PAUSED_HINT}` : nextText}`,
        next,
      }
    case "stale":
      return { tone: "warn", chip: `Synced ${ago}`, detail: `No complete sync for ${ago?.replace(" ago", "")}.${upTo} ${PAUSED_HINT}`, next }
    case "backfill":
      return {
        tone: "warn",
        chip: "Backfill pending",
        detail: "The first import (backfill) hasn't finished. Ask Grok Bot to run the X Growth backfill; it picks up where it stopped.",
        next,
      }
    case "partial":
      return {
        tone: "warn",
        chip: `Synced ${ago}`,
        detail: `The last run stopped early, usually Grok Bot's X read limit. The next run continues from the last complete sync.${upTo}${nextText}`,
        next,
      }
    case "ok":
      return { tone: "ok", chip: `Synced ${ago}`, detail: `${upTo.trim()}${nextText}`, next }
  }
}

export const toneDot: Record<HealthTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-destructive",
  muted: "bg-muted-foreground/50",
}
