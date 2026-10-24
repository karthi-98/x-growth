import { and, asc, eq, gte, isNull, lt, lte, or } from "drizzle-orm"

import { db as defaultDb } from "../db/client"
import { drafts, posts, type Draft, type DraftStatus, type StoredPostType } from "../db/schema"
import { postUrl, readSettings, type AppSettings } from "../settings"
import { spendSince, X_PRICES_USD } from "../spend"
import { createPost as xCreatePost, isDryRunId, type CreatePostInput, type CreatePostResult } from "../x/client"
import { XApiError } from "../x/errors"
import { normalizeForMatch, partsCostUsd, formatUsd } from "../x/text"
import { formatInZone, monthStartUtc } from "./zoned"

/*
 * Sends scheduled drafts (docs/ARCHITECTURE.md sections 4.4 and 4.5). Runs in
 * the worker every 30 s and from "Post now" in the web app; a conditional
 * update (scheduled → publishing) makes sure only one of them sends a draft.
 *
 * Crash safety: each part's id is saved the moment X returns it, so a draft
 * left in `publishing` (the app died mid-send) knows which parts went out.
 * It becomes `needs-check`, and is resolved by a synced post with the same
 * text or by the user (Retry / Mark as posted). Nothing is retried blindly.
 */

type Db = typeof defaultDb

export type PublishState = {
  /** Epoch ms; the worker sends nothing before this (X rate limit, key problem, offline). */
  pausedUntil: number
  pauseReason?: string
}

export type PublishDeps = {
  db?: Db
  createPost?: (input: CreatePostInput) => Promise<CreatePostResult>
  now?: () => Date
  settings?: AppSettings
  /** USD spent this month across X and AI; defaults to the spend ledger. */
  spentThisMonthUsd?: () => Promise<number>
  log?: (message: string) => void
  state?: PublishState
}

type Ctx = Required<Omit<PublishDeps, "spentThisMonthUsd" | "settings">> & {
  settings: AppSettings
  spentThisMonthUsd: () => Promise<number>
}

const sharedState: PublishState = { pausedUntil: 0 }

/** A `publishing` draft untouched this long was interrupted (a send times out after 30 s). */
export const STUCK_AFTER_MS = 2 * 60_000
/** Pause after an account-level problem (keys, permissions, credits) so X isn't hammered. */
const ACCOUNT_PAUSE_MS = 10 * 60_000
/** Pause after a connection that never reached X. */
const OFFLINE_PAUSE_MS = 60_000

export const PRICES = { post: X_PRICES_USD.postCreate, postWithUrl: X_PRICES_USD.postCreateWithUrl }

export const NEEDS_CHECK_MESSAGE =
  "The app stopped or lost X while sending this, so it may or may not be on X. Check your profile, then Retry or " +
  "Mark as posted. If the post shows up in a sync, this resolves on its own."

async function context(deps: PublishDeps): Promise<Ctx> {
  const db = deps.db ?? defaultDb
  const now = deps.now ?? (() => new Date())
  const settings = deps.settings ?? (await readSettings())
  return {
    db,
    createPost: deps.createPost ?? ((input) => xCreatePost(input)),
    now,
    settings,
    log: deps.log ?? (() => {}),
    state: deps.state ?? sharedState,
    spentThisMonthUsd:
      deps.spentThisMonthUsd ??
      (async () => {
        const s = await spendSince(monthStartUtc(now(), settings.timeZone))
        return s.x + s.ai
      }),
  }
}

export function draftParts(draft: Pick<Draft, "parts">): string[] {
  try {
    const parsed = JSON.parse(draft.parts)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function draftPublishedIds(draft: Pick<Draft, "publishedIds">): string[] {
  if (!draft.publishedIds) return []
  try {
    const parsed = JSON.parse(draft.publishedIds)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** Estimated cost of the parts not sent yet. */
export const remainingCostUsd = (draft: Draft) =>
  partsCostUsd(draftParts(draft).slice(draftPublishedIds(draft).length), PRICES)

export type PublishOutcome = {
  id: string
  /** "held" = still scheduled (spend cap, no keys, paused); see `error`. */
  status: DraftStatus | "held" | "skipped"
  ids: string[]
  error?: string
}

/** Why a draft can't be sent right now, or null when it can. "Post now" ignores the pause. */
async function holdReason(ctx: Ctx, draft: Draft, ignorePause: boolean): Promise<string | null> {
  if (!ignorePause && ctx.state.pausedUntil > ctx.now().getTime()) {
    const until = formatInZone(new Date(ctx.state.pausedUntil), ctx.settings.timeZone)
    return `Waiting until ${until}. ${ctx.state.pauseReason ?? ""}`.trim()
  }
  const cap = ctx.settings.monthlySpendCapUsd
  if (cap != null) {
    const spent = await ctx.spentThisMonthUsd()
    const cost = remainingCostUsd(draft)
    if (spent + cost > cap + 1e-9) {
      return `Held by your monthly spend cap of ${formatUsd(cap)}: ${formatUsd(spent)} spent this month, this needs ${formatUsd(cost)}.`
    }
  }
  return null
}

async function setFields(ctx: Ctx, id: string, fields: Partial<Draft>) {
  await ctx.db
    .update(drafts)
    .set({ ...fields, updatedAt: ctx.now().toISOString() })
    .where(eq(drafts.id, id))
}

function postType(index: number, draft: Draft): StoredPostType {
  if (index > 0) return "reply"
  if (draft.quoteId) return "quote"
  if (draft.inReplyToId) return "reply"
  return "original"
}

/**
 * Claim one scheduled draft and send its remaining parts in order, each
 * replying to the previous one. Safe to call from the worker and the web app.
 */
async function sendDraft(ctx: Ctx, id: string, ignorePause = false): Promise<PublishOutcome> {
  const [current] = await ctx.db.select().from(drafts).where(eq(drafts.id, id))
  if (!current) return { id, status: "skipped", ids: [], error: "Draft not found." }
  if (current.status !== "scheduled") return { id, status: "skipped", ids: draftPublishedIds(current) }

  const held = await holdReason(ctx, current, ignorePause)
  if (held) {
    if (held !== current.error) await setFields(ctx, id, { error: held })
    return { id, status: "held", ids: draftPublishedIds(current), error: held }
  }

  const [draft] = await ctx.db
    .update(drafts)
    .set({ status: "publishing", updatedAt: ctx.now().toISOString() })
    .where(and(eq(drafts.id, id), eq(drafts.status, "scheduled")))
    .returning()
  if (!draft) return { id, status: "skipped", ids: [] }

  const parts = draftParts(draft)
  const ids = draftPublishedIds(draft)
  if (!parts.length || parts.some((p) => !p.trim())) {
    await setFields(ctx, id, { status: "failed", error: "This draft has an empty part." })
    return { id, status: "failed", ids, error: "This draft has an empty part." }
  }

  for (let i = ids.length; i < parts.length; i++) {
    const input: CreatePostInput = { text: parts[i] }
    const replyTo = i === 0 ? draft.inReplyToId : ids[i - 1]
    if (replyTo) input.replyToId = replyTo
    if (i === 0 && draft.quoteId) input.quoteId = draft.quoteId

    let result: CreatePostResult
    try {
      result = await ctx.createPost(input)
    } catch (err) {
      return failPart(ctx, draft, ids, i, err)
    }

    ids.push(result.id)
    // Save the id first: if the app dies after this, the draft knows this part went out.
    await setFields(ctx, id, { publishedIds: JSON.stringify(ids) })
    if (!isDryRunId(result.id)) {
      const at = ctx.now().toISOString()
      await ctx.db
        .insert(posts)
        .values({
          id: result.id,
          createdAt: at,
          text: result.text || parts[i],
          type: postType(i, draft),
          url: postUrl(result.id, ctx.settings),
          fetchedAt: at,
          conversationId: draft.inReplyToId ? null : ids[0],
          repliedToId: input.replyToId ?? null,
          quotedId: input.quoteId ?? null,
        })
        .onConflictDoNothing()
    }
    ctx.log(`sent part ${i + 1}/${parts.length} of draft ${id} as ${result.id}`)
  }

  await setFields(ctx, id, { status: "published", error: null })
  return { id, status: "published", ids }
}

async function failPart(ctx: Ctx, draft: Draft, ids: string[], index: number, err: unknown): Promise<PublishOutcome> {
  const id = draft.id
  const message = err instanceof Error ? err.message : String(err)
  const where = draftParts(draft).length > 1 ? ` (part ${index + 1})` : ""
  const kind = err instanceof XApiError ? err.kind : "server"
  const now = ctx.now().getTime()

  // Never sent, or an account-level problem: keep it scheduled and pause.
  const hold = (pauseMs: number) => {
    ctx.state.pausedUntil = Math.max(ctx.state.pausedUntil, now + pauseMs)
    ctx.state.pauseReason = message
    return setFields(ctx, id, { status: "scheduled", error: message + where }).then(
      (): PublishOutcome => ({ id, status: "held", ids, error: message + where })
    )
  }
  if (err instanceof XApiError && err.kind === "rate-limit") return hold((err.retryAt?.getTime() ?? now + 15 * 60_000) - now)
  if (kind === "no-keys" || kind === "auth" || kind === "permissions" || kind === "billing") return hold(ACCOUNT_PAUSE_MS)
  if (err instanceof XApiError && err.kind === "network" && !err.maybeSent) return hold(OFFLINE_PAUSE_MS)

  // X may have created the post: never resend without a check.
  if (kind === "server" || kind === "network") {
    const error = `${message}${where} ${NEEDS_CHECK_MESSAGE}`
    await setFields(ctx, id, { status: "needs-check", error })
    return { id, status: "needs-check", ids, error }
  }

  // The request itself was refused (duplicate, forbidden, invalid).
  await setFields(ctx, id, { status: "failed", error: message + where })
  return { id, status: "failed", ids, error: message + where }
}

/** Mark drafts left in `publishing` by a crash or shutdown as `needs-check`. */
export async function recoverInterrupted(deps: PublishDeps = {}): Promise<string[]> {
  const ctx = await context(deps)
  const cutoff = new Date(ctx.now().getTime() - STUCK_AFTER_MS).toISOString()
  const rows = await ctx.db
    .update(drafts)
    .set({ status: "needs-check", error: NEEDS_CHECK_MESSAGE, updatedAt: ctx.now().toISOString() })
    .where(and(eq(drafts.status, "publishing"), lt(drafts.updatedAt, cutoff)))
    .returning({ id: drafts.id })
  return rows.map((r) => r.id)
}

/**
 * Resolve `needs-check` drafts from synced posts: each unsent part must match
 * a post with the same text, created after the draft was due and after the
 * previous part. Partial matches advance `published_ids`.
 */
export async function resolveNeedsCheck(deps: PublishDeps = {}): Promise<string[]> {
  const ctx = await context(deps)
  const pending = await ctx.db.select().from(drafts).where(eq(drafts.status, "needs-check"))
  const resolved: string[] = []
  for (const draft of pending) {
    const parts = draftParts(draft)
    const ids = draftPublishedIds(draft)
    if (!parts.length) continue
    // Sending never starts before the due time; allow for clock skew.
    const since = new Date(Date.parse(draft.scheduledAt ?? draft.createdAt) - 5 * 60_000).toISOString()
    const candidates = await ctx.db
      .select({ id: posts.id, text: posts.text, createdAt: posts.createdAt })
      .from(posts)
      .where(gte(posts.createdAt, since))
      .orderBy(asc(posts.createdAt))
      .limit(2000)
    let after = since
    const found = [...ids]
    for (let i = ids.length; i < parts.length; i++) {
      const want = normalizeForMatch(parts[i])
      const hit = candidates.find((c) => c.createdAt >= after && !found.includes(c.id) && normalizeForMatch(c.text) === want)
      if (!hit) break
      found.push(hit.id)
      after = hit.createdAt
    }
    if (found.length === ids.length) continue
    if (found.length === parts.length) {
      await setFields(ctx, draft.id, { status: "published", publishedIds: JSON.stringify(found), error: null })
      resolved.push(draft.id)
    } else {
      await setFields(ctx, draft.id, { publishedIds: JSON.stringify(found) })
    }
  }
  return resolved
}

/** Scheduled drafts late by more than the grace period, with nothing sent yet, become `missed`. */
export async function markMissed(deps: PublishDeps = {}): Promise<string[]> {
  const ctx = await context(deps)
  const grace = ctx.settings.autoPostGraceMinutes
  const cutoff = new Date(ctx.now().getTime() - grace * 60_000).toISOString()
  const late = await ctx.db
    .select()
    .from(drafts)
    .where(and(eq(drafts.status, "scheduled"), lt(drafts.scheduledAt, cutoff)))
  const missed: string[] = []
  for (const draft of late) {
    if (draftPublishedIds(draft).length) continue // a thread already under way finishes
    const due = formatInZone(draft.scheduledAt!, ctx.settings.timeZone)
    const why = draft.error ? ` Last problem: ${draft.error}` : " The app wasn't running then."
    const [row] = await ctx.db
      .update(drafts)
      .set({
        status: "missed",
        error: `Not sent: it was due ${due}, more than ${grace} min ago.${why}`,
        updatedAt: ctx.now().toISOString(),
      })
      .where(and(eq(drafts.id, draft.id), eq(drafts.status, "scheduled")))
      .returning({ id: drafts.id })
    if (row) missed.push(row.id)
  }
  return missed
}

export type PublishSummary = {
  published: string[]
  failed: string[]
  missed: string[]
  needsCheck: string[]
  resolved: string[]
  held: string[]
}

/**
 * One publish pass: recover interrupted sends, resolve checks, flag missed
 * posts, then send every due draft in schedule order.
 */
export async function publishDue(deps: PublishDeps = {}): Promise<PublishSummary> {
  const ctx = await context(deps)
  const summary: PublishSummary = { published: [], failed: [], missed: [], needsCheck: [], resolved: [], held: [] }

  summary.needsCheck.push(...(await recoverInterrupted(ctx)))
  summary.resolved.push(...(await resolveNeedsCheck(ctx)))
  summary.missed.push(...(await markMissed(ctx)))

  const due = await ctx.db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.status, "scheduled"), or(isNull(drafts.scheduledAt), lte(drafts.scheduledAt, ctx.now().toISOString()))))
    .orderBy(asc(drafts.scheduledAt), asc(drafts.createdAt))

  for (const { id } of due) {
    const out = await sendDraft(ctx, id)
    if (out.status === "published") summary.published.push(id)
    else if (out.status === "failed") summary.failed.push(id)
    else if (out.status === "needs-check") summary.needsCheck.push(id)
    else if (out.status === "held") summary.held.push(id)
  }
  return summary
}

/** Statuses the user may send again with "Post now" / "Retry". */
export const SENDABLE_STATUSES = ["draft", "scheduled", "missed", "failed", "needs-check"] as const

/**
 * "Post now" / "Retry": schedule for now and send right away. Continues a
 * thread from its first unsent part. If it can't go out right now (spend
 * cap, keys, rate limit), the draft goes back to where it was, so the worker
 * never sends it later behind the user's back.
 */
export async function publishNow(id: string, deps: PublishDeps = {}): Promise<PublishOutcome> {
  const ctx = await context(deps)
  const skipped: PublishOutcome = { id, status: "skipped", ids: [], error: "This post is already being sent or was sent." }
  const [before] = await ctx.db.select().from(drafts).where(eq(drafts.id, id))
  if (!before || !(SENDABLE_STATUSES as readonly string[]).includes(before.status)) return skipped

  const nowIso = ctx.now().toISOString()
  const [row] = await ctx.db
    .update(drafts)
    .set({ status: "scheduled", scheduledAt: nowIso, error: null, updatedAt: nowIso })
    .where(and(eq(drafts.id, id), eq(drafts.status, before.status)))
    .returning({ id: drafts.id })
  if (!row) return skipped

  const out = await sendDraft(ctx, id, true)
  if (out.status === "held") {
    await ctx.db
      .update(drafts)
      .set({ status: before.status, scheduledAt: before.scheduledAt, updatedAt: ctx.now().toISOString() })
      .where(and(eq(drafts.id, id), eq(drafts.status, "scheduled")))
  }
  return out
}
