import { readSecrets } from "../secrets"
import { readSettings } from "../settings"
import { getPlan } from "./status"

/*
 * "Sync now" (docs/ARCHITECTURE.md section 4.3): POST to the user's Grok Bot
 * webhook routine. Server-side only; the key never reaches the browser or a
 * log. A 2xx only means the run started: the import still needs the user's
 * approval in Grok Bot, and its result shows up in sync_runs.
 */

export type SyncNowReason = "user-click" | "stale-on-start"

export type SyncNowResult =
  | { ok: true; status: number; mode: string; from: string; at: string }
  | { ok: false; error: string }

/** https URLs, plus http on this computer for testing. */
export function isWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === "https:") return true
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  } catch {
    return false
  }
}

export async function webhookConfigured(): Promise<boolean> {
  const settings = await readSettings()
  return !!settings.sync.webhookUrl && !!readSecrets().grokBotWebhookKey
}

export async function triggerSyncWebhook(reason: SyncNowReason, now = new Date()): Promise<SyncNowResult> {
  const settings = await readSettings()
  const url = settings.sync.webhookUrl
  const key = readSecrets().grokBotWebhookKey
  if (!url || !key) return { ok: false, error: "Add the Grok Bot webhook URL and key first." }
  if (!isWebhookUrl(url)) return { ok: false, error: "The webhook URL must start with https://." }

  const { next } = await getPlan(now, settings)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ action: "sync", mode: next.type, from: next.from, reason }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError"
    return {
      ok: false,
      error: timedOut
        ? "Grok Bot didn't answer within 15 seconds. Try again in a minute."
        : "Couldn't reach the Grok Bot webhook. Check the URL and your internet connection.",
    }
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? " The webhook key looks wrong; copy it again from the routine in Grok Bot."
        : res.status === 404
          ? " The webhook URL wasn't found; the routine may have been deleted."
          : res.status === 429
            ? " Grok Bot is limiting runs right now; try again later."
            : ""
    return { ok: false, error: `Grok Bot answered ${res.status} ${res.statusText}.${hint}`.trim() }
  }
  return { ok: true, status: res.status, mode: next.type, from: next.from, at: now.toISOString() }
}
