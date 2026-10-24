import { randomUUID } from "node:crypto"

import { and, count, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm"

import { hasLink } from "@/lib/ai/text"
import { db } from "@/lib/db/client"
import { drafts, mentions, posts, type Draft, type Mention } from "@/lib/db/schema"
import { X_PRICES_USD } from "@/lib/spend"

/*
 * Replies inbox data: mentions with the post they reply to and some thread
 * context, plus queueing a reply. No Next.js imports, so tests can run it
 * under plain Bun; pages call `connection()` before using it.
 *
 * Sending never calls X here: it inserts a `drafts` row (kind "reply",
 * status "scheduled", due now) and the compose stream's publish job posts
 * it (docs/WORKSTREAMS.md).
 */

export const replyFilters = ["unhandled", "handled", "all"] as const
export type ReplyFilter = (typeof replyFilters)[number]

export const parseReplyFilter = (v: string | string[] | undefined): ReplyFilter => {
  const s = Array.isArray(v) ? v[0] : v
  return replyFilters.includes(s as ReplyFilter) ? (s as ReplyFilter) : "unhandled"
}

export type ContextPost = {
  id: string
  /** "@handle" or "you". */
  author: string
  mine: boolean
  text: string
  createdAt: string
}

export type ReplyDraftSummary = Pick<Draft, "id" | "status" | "error" | "scheduledAt"> & { text: string }

export type MentionView = Mention & {
  /** The post this mention replies to, when it's in the local DB. */
  repliedTo: ContextPost | null
  /** The reply chain above repliedTo (or the conversation's first post), oldest first. */
  thread: ContextPost[]
  replyDraft: ReplyDraftSummary | null
}

/** Statuses that mean a reply is on its way or already out. */
const ACTIVE_DRAFT: Draft["status"][] = ["scheduled", "publishing", "published", "needs-check"]
const THREAD_LIMIT = 4
const MAX_REPLY_CHARS = 25_000

const filterWhere = (filter: ReplyFilter) =>
  filter === "unhandled" ? isNull(mentions.handledAt) : filter === "handled" ? isNotNull(mentions.handledAt) : undefined

export async function mentionCounts(): Promise<Record<ReplyFilter, number>> {
  const rows = await db
    .select({ handled: isNotNull(mentions.handledAt), n: count() })
    .from(mentions)
    .groupBy(isNotNull(mentions.handledAt))
  const handled = Number(rows.find((r) => Boolean(r.handled))?.n ?? 0)
  const unhandled = Number(rows.find((r) => !r.handled)?.n ?? 0)
  return { unhandled, handled, all: handled + unhandled }
}

const parts = (json: string): string[] => {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : []
  } catch {
    return []
  }
}

/** Newest first, with context. */
export async function listMentions(filter: ReplyFilter, limit = 50): Promise<MentionView[]> {
  const rows = await db.select().from(mentions).where(filterWhere(filter)).orderBy(desc(mentions.createdAt)).limit(limit)
  return withContext(rows)
}

export async function getMention(id: string): Promise<MentionView | null> {
  const rows = await db.select().from(mentions).where(eq(mentions.id, id)).limit(1)
  return (await withContext(rows))[0] ?? null
}

async function withContext(rows: Mention[]): Promise<MentionView[]> {
  if (!rows.length) return []
  const conversationIds = [...new Set(rows.map((m) => m.conversationId).filter((v): v is string => !!v))]
  const parentIds = [...new Set(rows.map((m) => m.inReplyToId).filter((v): v is string => !!v))]
  const draftIds = rows.map((m) => m.replyDraftId).filter((v): v is string => !!v)

  const [ownPosts, threadMentions, draftRows] = await Promise.all([
    parentIds.length || conversationIds.length
      ? db
          .select({
            id: posts.id,
            text: posts.text,
            createdAt: posts.createdAt,
            conversationId: posts.conversationId,
            repliedToId: posts.repliedToId,
          })
          .from(posts)
          .where(
            or(
              parentIds.length ? inArray(posts.id, parentIds) : undefined,
              conversationIds.length ? inArray(posts.id, conversationIds) : undefined,
              conversationIds.length ? inArray(posts.conversationId, conversationIds) : undefined
            )
          )
      : Promise.resolve([]),
    conversationIds.length
      ? db.select().from(mentions).where(inArray(mentions.conversationId, conversationIds))
      : Promise.resolve([] as Mention[]),
    draftIds.length ? db.select().from(drafts).where(inArray(drafts.id, draftIds)) : Promise.resolve([] as Draft[]),
  ])

  type Node = ContextPost & { parentId: string | null }
  const nodes = new Map<string, Node>()
  for (const p of ownPosts) {
    nodes.set(p.id, { id: p.id, author: "you", mine: true, text: p.text, createdAt: p.createdAt, parentId: p.repliedToId })
  }
  for (const t of threadMentions) {
    if (nodes.has(t.id)) continue
    nodes.set(t.id, {
      id: t.id,
      author: t.authorUsername ? `@${t.authorUsername}` : (t.authorName ?? "someone"),
      mine: false,
      text: t.text,
      createdAt: t.createdAt,
      parentId: t.inReplyToId,
    })
  }
  const draftById = new Map(draftRows.map((d) => [d.id, d]))
  const view = ({ parentId: _parentId, ...post }: Node): ContextPost => post

  return rows.map((m) => {
    const parent = m.inReplyToId ? nodes.get(m.inReplyToId) : undefined
    const repliedTo = parent ? view(parent) : null

    // Walk the reply chain above the post being replied to (not every reply in a busy conversation).
    const chain: ContextPost[] = []
    const seen = new Set([m.id])
    let cur = parent?.parentId ? nodes.get(parent.parentId) : undefined
    while (cur && !seen.has(cur.id) && chain.length < THREAD_LIMIT) {
      seen.add(cur.id)
      chain.unshift(view(cur))
      cur = cur.parentId ? nodes.get(cur.parentId) : undefined
    }
    // The chain has a gap: at least show where the conversation started.
    const root = m.conversationId ? nodes.get(m.conversationId) : undefined
    if (root && root.id !== repliedTo?.id && !chain.some((p) => p.id === root.id)) chain.unshift(view(root))
    const thread = chain.slice(-THREAD_LIMIT)

    const d = m.replyDraftId ? draftById.get(m.replyDraftId) : undefined
    const replyDraft = d
      ? { id: d.id, status: d.status, error: d.error, scheduledAt: d.scheduledAt, text: parts(d.parts).join("\n\n") }
      : null
    return { ...m, repliedTo, thread, replyDraft }
  })
}

export async function setMentionHandled(id: string, handled: boolean, now: Date = new Date()): Promise<boolean> {
  const res = await db
    .update(mentions)
    .set({ handledAt: handled ? now.toISOString() : null })
    .where(eq(mentions.id, id))
  return res.rowsAffected > 0
}

export class ReplyError extends Error {}

/**
 * Queue a reply for the publish job and link it to the mention, which is
 * then marked handled. Refuses when a reply is already queued or posted.
 */
export async function queueReply(input: {
  mentionId: string
  text: string
  /** The reply started as an AI draft (even if edited). */
  fromAi: boolean
  now?: Date
}): Promise<{ draftId: string; estCostUsd: number }> {
  const text = input.text.trim()
  if (!text) throw new ReplyError("Write a reply first.")
  if (text.length > MAX_REPLY_CHARS) throw new ReplyError("That reply is too long for X.")

  const now = (input.now ?? new Date()).toISOString()
  const estCostUsd = hasLink(text) ? X_PRICES_USD.postCreateWithUrl : X_PRICES_USD.postCreate
  const draftId = randomUUID()

  await db.transaction(async (tx) => {
    const [mention] = await tx.select().from(mentions).where(eq(mentions.id, input.mentionId)).limit(1)
    if (!mention) throw new ReplyError("That mention isn't in your inbox any more.")
    if (mention.replyDraftId) {
      const [prev] = await tx.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, mention.replyDraftId))
      if (prev && ACTIVE_DRAFT.includes(prev.status)) throw new ReplyError("A reply to this mention is already queued.")
    }
    await tx.insert(drafts).values({
      id: draftId,
      kind: "reply",
      parts: JSON.stringify([text]),
      inReplyToId: mention.id,
      scheduledAt: now,
      status: "scheduled",
      origin: input.fromAi ? "ai" : "user",
      estCostUsd,
      createdAt: now,
      updatedAt: now,
    })
    const linked = await tx
      .update(mentions)
      .set({ replyDraftId: draftId, handledAt: now })
      .where(
        and(
          eq(mentions.id, mention.id),
          mention.replyDraftId ? eq(mentions.replyDraftId, mention.replyDraftId) : isNull(mentions.replyDraftId)
        )
      )
    // Someone else linked a reply in between: undo ours.
    if (linked.rowsAffected === 0) throw new ReplyError("A reply to this mention is already queued.")
  })

  return { draftId, estCostUsd }
}
