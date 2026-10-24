"use server"

import { saveCompose, type ComposeInput, type ComposeIntent, type ComposeResult } from "@/lib/publish/drafts"

const INTENTS: ComposeIntent[] = ["draft", "schedule", "now"]
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined)

/** Save, schedule or post what's in the editor. Input arrives over the wire, so it's re-checked here. */
export async function composeAction(raw: ComposeInput): Promise<ComposeResult> {
  if (!raw || !Array.isArray(raw.parts) || !INTENTS.includes(raw.intent)) {
    return { ok: false, error: "Something went wrong reading the editor. Reload and try again." }
  }
  return saveCompose({
    draftId: str(raw.draftId, 64),
    parts: raw.parts.slice(0, 100).map((p) => (typeof p === "string" ? p.slice(0, 10_000) : "")),
    replyTo: str(raw.replyTo, 500),
    quote: str(raw.quote, 500),
    intent: raw.intent,
    scheduleLocal: str(raw.scheduleLocal, 16),
  })
}
