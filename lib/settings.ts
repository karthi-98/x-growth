import { eq } from "drizzle-orm"

import { DEFAULT_TIME_ZONE, isValidTimeZone } from "./dates"
import { db } from "./db/client"
import { settings as settingsTable } from "./db/schema"

/*
 * Non-secret app settings, stored as key -> JSON in the `settings` table and
 * merged over DEFAULT_SETTINGS. Keys and tokens live in lib/secrets.ts.
 * Server components call getSettings() from lib/get-settings.ts; scripts,
 * the CLI and the worker call readSettings() here (no Next.js imports, so it
 * runs under plain Bun).
 */

export type PayPeriodSettings = {
  /** First day (YYYY-MM-DD, display timezone) of any one known pay period. */
  anchor: string
  /** Length of each period in days. */
  days: number
  /** Payout date = period end + this many days. */
  payoutOffsetDays: number
}

export type SyncSettings = {
  /** Window for the first import and "Refresh all". */
  backfillDays: number
  /** Window for the first successful run of each local day. */
  fullRefreshDays: number
  /** Window for later runs the same day. */
  lightRefreshHours: number
  /** "new-only" stores new replies but refreshes metrics on originals/quotes only. */
  refreshReplies: "all" | "new-only"
  /** Reminder times (HH:mm, display timezone) the Grok Bot routines use. */
  reminderTimes: string[]
  /** Grok Bot webhook routine for "Sync now"; null until the user pastes it. */
  webhookUrl: string | null
}

export type AppSettings = {
  /** X handle without "@", or null before setup. */
  handle: string | null
  /** Numeric X user id, or null before setup. */
  userId: string | null
  /** IANA timezone for day bucketing and labels. */
  timeZone: string
  /** Null hides pay-period features. */
  payPeriod: PayPeriodSettings | null
  sync: SyncSettings
  /** Scheduled posts late by at most this many minutes still go out on start. */
  autoPostGraceMinutes: number
  /** Optional monthly spend cap in USD across X writes and AI; null = no cap. */
  monthlySpendCapUsd: number | null
  /** Last bot pack version seen in an import (lib/bot-pack.ts); written by the import pipeline. */
  botPack: { version: number | null; seenAt: string | null }
}

export const DEFAULT_SETTINGS: AppSettings = {
  handle: null,
  userId: null,
  timeZone: DEFAULT_TIME_ZONE,
  payPeriod: { anchor: "2026-10-21", days: 14, payoutOffsetDays: 3 },
  sync: {
    backfillDays: 90,
    fullRefreshDays: 7,
    lightRefreshHours: 24,
    refreshReplies: "all",
    reminderTimes: ["08:00", "13:00", "18:00", "22:00"],
    webhookUrl: null,
  },
  autoPostGraceMinutes: 30,
  monthlySpendCapUsd: null,
  botPack: { version: null, seenAt: null },
}

type SettingKey = keyof AppSettings

function merge(rows: { key: string; value: string }[]): AppSettings {
  const out: AppSettings = structuredClone(DEFAULT_SETTINGS)
  for (const { key, value } of rows) {
    if (!(key in DEFAULT_SETTINGS)) continue
    try {
      const parsed = JSON.parse(value)
      const k = key as SettingKey
      const base = DEFAULT_SETTINGS[k]
      ;(out as Record<string, unknown>)[k] =
        base && typeof base === "object" && !Array.isArray(base) && parsed && typeof parsed === "object"
          ? { ...base, ...parsed }
          : parsed
    } catch {
      // Ignore a corrupt row; the default stays.
    }
  }
  if (!isValidTimeZone(out.timeZone)) out.timeZone = DEFAULT_TIME_ZONE
  return out
}

/** Current settings (defaults merged with stored values). */
export async function readSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settingsTable)
  return merge(rows)
}

/** Upsert some top-level settings. Nested objects are merged with what's stored. */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readSettings()
  const now = new Date().toISOString()
  for (const [key, value] of Object.entries(patch) as [SettingKey, unknown][]) {
    const base = current[key]
    const next =
      base && typeof base === "object" && !Array.isArray(base) && value && typeof value === "object"
        ? { ...base, ...value }
        : value
    const json = JSON.stringify(next)
    await db
      .insert(settingsTable)
      .values({ key, value: json, updatedAt: now })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: json, updatedAt: now } })
  }
  return readSettings()
}

/** Remove a stored setting so its default applies again. */
export async function resetSetting(key: SettingKey): Promise<void> {
  await db.delete(settingsTable).where(eq(settingsTable.key, key))
}

/** "@designwkarthick", or a generic label before setup. */
export const accountLabel = (s: Pick<AppSettings, "handle">) =>
  s.handle ? `@${s.handle}` : "Your X account"

/** Public URL for a post: the handle's status URL, or X's handle-free form. */
export const postUrl = (id: string, s: Pick<AppSettings, "handle">) =>
  s.handle ? `https://x.com/${s.handle}/status/${id}` : `https://x.com/i/status/${id}`
