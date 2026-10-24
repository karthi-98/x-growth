/** Choices offered in Settings > Sync; the server actions accept only these. */
export const BACKFILL_DAYS = [30, 90, 180] as const
export const FULL_REFRESH_DAYS = [3, 7, 14] as const
export const LIGHT_REFRESH_HOURS = [12, 24, 48] as const
export const MAX_REMINDERS = 8
/** Grok Bot runs must be at least 5 minutes apart (docs/ARCHITECTURE.md section 6.4). */
export const MIN_REMINDER_GAP_MIN = 5
