import { randomUUID } from "node:crypto"

import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm"

import { db as defaultDb } from "../db/client"
import { drafts, type Draft, type DraftStatus } from "../db/schema"
import { readSettings } from "../settings"
import { MAX_POST_LENGTH, parsePostRef, partsCostUsd, weightedLength } from "../x/text"
import { PRICES, publishNow, type PublishDeps, type PublishOutcome } from "./index"
import { formatInZone, zonedLocalToUtc } from "./zoned"

/*
 * Draft writes behind the compose and queue pages. The pages' server actions
 * call these; the publisher in ./index.ts does the sending.
 */

type Db = typeof defaultDb

/** X accepts long threads, but past this a draft is almost certainly a paste mistake. */
export const MAX_PARTS = 25

/** Statuses whose text can still be edited (nothing sent yet). */
export const EDITABLE_STATUSES = ["draft", "scheduled", "missed", "failed"] as const

export type ComposeIntent = "draft" | "schedule" | "now"

export type ComposeInput = {
  /** Set when editing an existing draft. */
  draftId?: string
  parts: string[]
  /** Pasted post URL or id to reply to. */
  replyTo?: string
  /** Pasted post URL or id to quote. */
  quote?: string
  intent: ComposeIntent
  /** `YYYY-MM-DDTHH:mm` in settings.timeZone, for intent "schedule". */
  scheduleLocal?: string
}

export type ComposeResult =
  | { ok: true; draftId: string; message: string; outcome?: PublishOutcome }
  /** `draftId` is set when the text was saved but not sent, so the editor keeps editing that draft. */
  | { ok: false; error: string; draftId?: string }

type DraftDeps = PublishDeps & { db?: Db }

function validate(input: ComposeInput): { parts: string[]; replyToId: string | null; quoteId: string | null } | string {
  const sending = input.intent !== "draft"
  const parts = input.parts.map((p) => p.trim())
  const kept = sending ? parts : parts.filter(Boolean)
  if (!kept.length || kept.every((p) => !p)) return "Write something first."
  if (kept.length > MAX_PARTS) return `A thread can have at most ${MAX_PARTS} posts here.`
  if (sending) {
    const empty = kept.findIndex((p) => !p)
    if (empty >= 0) return kept.length > 1 ? `Post ${empty + 1} of the thread is empty.` : "Write something first."
    const long = kept.findIndex((p) => weightedLength(p) > MAX_POST_LENGTH)
    if (long >= 0) {
      return `${kept.length > 1 ? `Post ${long + 1}` : "The post"} is over ${MAX_POST_LENGTH} characters (${weightedLength(kept[long])}).`
    }
  }
  const replyToId = input.replyTo?.trim() ? parsePostRef(input.replyTo) : null
  if (input.replyTo?.trim() && !replyToId) return "The reply-to link isn't an X post URL."
  const quoteId = input.quote?.trim() ? parsePostRef(input.quote) : null
  if (input.quote?.trim() && !quoteId) return "The quote link isn't an X post URL."
  return { parts: kept, replyToId, quoteId }
}

/** No part of the draft is on X yet. */
const nothingSent = or(isNull(drafts.publishedIds), eq(drafts.publishedIds, "[]"))

const kindOf = (parts: string[], replyToId: string | null, quoteId: string | null): Draft["kind"] =>
  parts.length > 1 ? "thread" : replyToId ? "reply" : quoteId ? "quote" : "post"

/** Save, schedule or send what's in the compose editor. */
export async function saveCompose(input: ComposeInput, deps: DraftDeps = {}): Promise<ComposeResult> {
  const db = deps.db ?? defaultDb
  const now = deps.now?.() ?? new Date()
  const settings = deps.settings ?? (await readSettings())
  const checked = validate(input)
  if (typeof checked === "string") return { ok: false, error: checked }
  const { parts, replyToId, quoteId } = checked

  let scheduledAt: string | null = null
  let status: DraftStatus = "draft"
  if (input.intent === "schedule") {
    scheduledAt = input.scheduleLocal ? zonedLocalToUtc(input.scheduleLocal, settings.timeZone) : null
    if (!scheduledAt) return { ok: false, error: "Pick a date and time." }
    if (Date.parse(scheduledAt) < now.getTime() - 60_000) return { ok: false, error: "That time has already passed." }
    status = "scheduled"
  } else if (input.intent === "now") {
    // Saved as a plain draft first; publishNow claims and sends it.
    status = "draft"
  }

  const nowIso = now.toISOString()
  const fields = {
    kind: kindOf(parts, replyToId, quoteId),
    parts: JSON.stringify(parts),
    inReplyToId: replyToId,
    quoteId,
    scheduledAt,
    status,
    error: null,
    estCostUsd: partsCostUsd(parts, PRICES),
    updatedAt: nowIso,
  }

  let id = input.draftId
  if (id) {
    const [row] = await db
      .update(drafts)
      .set(fields)
      .where(and(eq(drafts.id, id), inArray(drafts.status, [...EDITABLE_STATUSES]), nothingSent))
      .returning({ id: drafts.id })
    if (!row) return { ok: false, error: "This draft can't be edited any more: it's being sent, or part of it is already on X." }
  } else {
    id = randomUUID()
    await db.insert(drafts).values({ id, ...fields, origin: "user", createdAt: nowIso })
  }

  if (input.intent === "now") {
    const outcome = await publishNow(id, { ...deps, db, settings })
    if (outcome.status === "published") {
      return { ok: true, draftId: id, outcome, message: parts.length > 1 ? "Thread posted." : "Posted." }
    }
    return { ok: false, draftId: id, error: outcome.error ?? `Not posted (${outcome.status}). See the queue.` }
  }
  if (input.intent === "schedule") {
    return { ok: true, draftId: id, message: `Scheduled for ${formatInZone(scheduledAt!, settings.timeZone)}.` }
  }
  return { ok: true, draftId: id, message: "Draft saved." }
}

type QueueDeps = { db?: Db; now?: () => Date; settings?: DraftDeps["settings"] }

/** Move a draft to a new time. Works for missed, failed, drafts and scheduled posts. */
export async function rescheduleDraft(id: string, local: string, deps: QueueDeps = {}): Promise<{ ok: boolean; error?: string }> {
  const db = deps.db ?? defaultDb
  const now = deps.now?.() ?? new Date()
  const settings = deps.settings ?? (await readSettings())
  const at = zonedLocalToUtc(local, settings.timeZone)
  if (!at) return { ok: false, error: "Pick a date and time." }
  if (Date.parse(at) < now.getTime() - 60_000) return { ok: false, error: "That time has already passed." }
  const rows = await db
    .update(drafts)
    .set({ status: "scheduled", scheduledAt: at, error: null, updatedAt: now.toISOString() })
    .where(and(eq(drafts.id, id), inArray(drafts.status, [...EDITABLE_STATUSES])))
    .returning({ id: drafts.id })
  return rows.length ? { ok: true } : { ok: false, error: "This post can't be rescheduled any more." }
}

/** Missed → back to drafts (the "Discard" on the missed banner keeps the text). */
export async function unscheduleDraft(id: string, deps: QueueDeps = {}) {
  const db = deps.db ?? defaultDb
  await db
    .update(drafts)
    .set({ status: "draft", scheduledAt: null, error: null, updatedAt: (deps.now?.() ?? new Date()).toISOString() })
    .where(and(eq(drafts.id, id), inArray(drafts.status, ["scheduled", "missed", "failed"])))
}

/** The user saw it on X: needs-check (or failed) → published. */
export async function markDraftPosted(id: string, deps: QueueDeps = {}) {
  const db = deps.db ?? defaultDb
  await db
    .update(drafts)
    .set({ status: "published", error: null, updatedAt: (deps.now?.() ?? new Date()).toISOString() })
    .where(and(eq(drafts.id, id), inArray(drafts.status, ["needs-check", "failed"])))
}

/** Delete from the app (never from X). Not while it's being sent. */
export async function deleteDraft(id: string, deps: QueueDeps = {}) {
  const db = deps.db ?? defaultDb
  await db.delete(drafts).where(and(eq(drafts.id, id), ne(drafts.status, "publishing")))
}

export async function getDraft(id: string, db: Db = defaultDb): Promise<Draft | null> {
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id))
  return row ?? null
}

export type QueueData = Record<"missed" | "needsCheck" | "failed" | "publishing" | "scheduled" | "drafts" | "published", Draft[]>

/** Everything the queue page lists; published history is the latest `historyLimit`. */
export async function loadQueue(db: Db = defaultDb, historyLimit = 50): Promise<QueueData> {
  const open = await db
    .select()
    .from(drafts)
    .where(ne(drafts.status, "published"))
    .orderBy(asc(drafts.scheduledAt), desc(drafts.updatedAt))
  const published = await db
    .select()
    .from(drafts)
    .where(eq(drafts.status, "published"))
    .orderBy(desc(drafts.updatedAt))
    .limit(historyLimit)
  const by = (s: DraftStatus) => open.filter((d) => d.status === s)
  return {
    missed: by("missed"),
    needsCheck: by("needs-check"),
    failed: by("failed"),
    publishing: by("publishing"),
    scheduled: by("scheduled"),
    drafts: by("draft").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    published,
  }
}
