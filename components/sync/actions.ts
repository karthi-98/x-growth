"use server"

import { and, desc, gte, ne } from "drizzle-orm"
import { refresh } from "next/cache"

import { db } from "@/lib/db/client"
import { syncRuns } from "@/lib/db/schema"
import { maskSecret, readSecrets, writeSecrets } from "@/lib/secrets"
import { readSettings, updateSettings, type SyncSettings } from "@/lib/settings"
import { isWebhookUrl, triggerSyncWebhook } from "@/lib/sync/webhook"
import { isReminderTime } from "@/lib/sync/window"

import { BACKFILL_DAYS, FULL_REFRESH_DAYS, LIGHT_REFRESH_HOURS, MAX_REMINDERS, MIN_REMINDER_GAP_MIN } from "./options"

/*
 * Settings > Sync. Every input is untrusted (actions are plain POSTs), so
 * each one is checked here. Keys are written to data/secrets.json and only
 * ever returned masked.
 */

export type ActionState = { ok: boolean; message: string } | null

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))

function pickNumber<T extends readonly number[]>(value: FormDataEntryValue | null, allowed: T): T[number] | null {
  const n = Number(value)
  return (allowed as readonly number[]).includes(n) ? (n as T[number]) : null
}

export async function saveSyncOptions(_prev: ActionState, form: FormData): Promise<ActionState> {
  const times = [...new Set(form.getAll("reminderTimes").map(String).map((t) => t.trim()).filter(Boolean))].sort()
  const bad = times.filter((t) => !isReminderTime(t))
  if (bad.length) return { ok: false, message: `Use 24-hour times like 08:00 (not ${bad.join(", ")}).` }
  if (times.length > MAX_REMINDERS) return { ok: false, message: `Use at most ${MAX_REMINDERS} reminders a day.` }
  for (let i = 0; i < times.length; i++) {
    const next = i + 1 < times.length ? minutes(times[i + 1]) : minutes(times[0]) + 1440
    if (times.length > 1 && next - minutes(times[i]) < MIN_REMINDER_GAP_MIN) {
      return { ok: false, message: `Reminders must be at least ${MIN_REMINDER_GAP_MIN} minutes apart.` }
    }
  }

  const backfillDays = pickNumber(form.get("backfillDays"), BACKFILL_DAYS)
  const fullRefreshDays = pickNumber(form.get("fullRefreshDays"), FULL_REFRESH_DAYS)
  const lightRefreshHours = pickNumber(form.get("lightRefreshHours"), LIGHT_REFRESH_HOURS)
  const refreshReplies = form.get("refreshReplies")
  if (!backfillDays || !fullRefreshDays || !lightRefreshHours || (refreshReplies !== "all" && refreshReplies !== "new-only")) {
    return { ok: false, message: "Pick one of the listed options for each window." }
  }

  const current = await readSettings()
  const sync: SyncSettings = {
    ...current.sync,
    reminderTimes: times,
    backfillDays,
    fullRefreshDays,
    lightRefreshHours,
    refreshReplies,
  }
  await updateSettings({ sync })
  refresh()
  return {
    ok: true,
    message: times.length
      ? "Saved. Ask Grok Bot to update the X Growth routines to the new times."
      : "Saved. With no reminders, nothing syncs on its own.",
  }
}

export async function saveWebhook(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (form.get("intent") === "remove") {
    const current = await readSettings()
    await updateSettings({ sync: { ...current.sync, webhookUrl: null } })
    writeSecrets({ grokBotWebhookKey: undefined })
    refresh()
    return { ok: true, message: "Removed the webhook URL and key." }
  }

  const url = String(form.get("webhookUrl") ?? "").trim()
  const key = String(form.get("webhookKey") ?? "").trim()
  if (!url) return { ok: false, message: "Paste the webhook URL from the X Growth routine in Grok Bot." }
  if (url.length > 2000 || !isWebhookUrl(url)) return { ok: false, message: "The webhook URL must start with https://." }
  if (key && (key.length > 500 || /\s/.test(key))) return { ok: false, message: "That key doesn't look right; copy it again." }
  if (!key && !readSecrets().grokBotWebhookKey) return { ok: false, message: "Paste the webhook key too." }

  const current = await readSettings()
  await updateSettings({ sync: { ...current.sync, webhookUrl: url } })
  if (key) writeSecrets({ grokBotWebhookKey: key })
  refresh()
  return { ok: true, message: `Saved. Key ${maskSecret(key || readSecrets().grokBotWebhookKey)}.` }
}

export type SyncNowState = { ok: true; message: string; at: string } | { ok: false; message: string } | null

export async function syncNow(): Promise<SyncNowState> {
  const res = await triggerSyncWebhook("user-click")
  if (!res.ok) return { ok: false, message: res.error }
  return {
    ok: true,
    at: res.at,
    message: `Grok Bot started a ${res.mode} sync. Approve the import in Grok Bot when it asks (within about 10 minutes).`,
  }
}

export type RunResult = {
  status: "ok" | "partial" | "failed" | "skipped"
  type: string
  postsReceived: number
  postsNew: number
  error: string | null
}

/** The first Grok Bot import that started at or after `since` (ISO), for Sync now to show. */
export async function latestRunSince(since: string): Promise<RunResult | null> {
  if (!Number.isFinite(Date.parse(since))) return null
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(and(gte(syncRuns.startedAt, new Date(since).toISOString()), ne(syncRuns.source, "file")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)
  if (!run) return null
  return {
    status: run.status,
    type: run.type,
    postsReceived: run.postsReceived,
    postsNew: run.postsNew,
    error: run.error,
  }
}
