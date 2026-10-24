import { randomUUID } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"

import { inArray, like, or, sql } from "drizzle-orm"

import {
  exportKinds,
  type ExportEnvelope,
  type ExportKind,
  type ImportResult,
  type RunTrigger,
  type RunType,
} from "../contract/envelope"
import { dateKeyIn } from "../dates"
import { db } from "../db/client"
import {
  accounts,
  accountSnapshots,
  inspirationPosts,
  mentions,
  postMetricSnapshots,
  posts,
  syncRunTypes,
  syncRuns,
  type NewPost,
  type NewSyncRun,
  type Post,
} from "../db/schema"
import { readSettings, updateSettings, type AppSettings, type SyncSettings } from "../settings"
import { coverageWindows, nextFor, nextRunAt, readSyncState, writeSyncState, type SyncStateRow } from "../sync/state"
import { computeCoverage, coversBackfill, isFullRefresh, type Coverage, type Interval } from "../sync/window"
import { rebuildAllDailyStats, rebuildDailyStats } from "./daily-stats"
import type { Queryable } from "./db"
import { isInInbox, listInbox, moveToFailed, moveToProcessed, pruneProcessed, withImportLock } from "./files"
import {
  inspirationFromApi,
  maxId,
  mentionFromApi,
  normalizeIso,
  parseLegacy,
  postFromApi,
  type LegacyFile,
} from "./formats"
import { looksLikeEnvelope, sizeProblem, validateEnvelope } from "./validate"

/*
 * The import pipeline (docs/ARCHITECTURE.md section 6.3). Each file is
 * validated and written in its own transaction; afterwards the coverage,
 * gap and `next` are worked out once for the whole batch. Running the same
 * file twice changes nothing but the sync_runs history.
 */

export type PostCounts = {
  received: number
  new: number
  /** Existing posts whose numbers or text changed. */
  updated: number
  /** Existing posts that came back identical (fetched_at still moves forward). */
  unchanged: number
  /** Not written: an older copy than the stored one, another author, or a reply under refreshReplies = new-only. */
  skipped: number
  /** "reply -> quote" style counts for stored posts whose type changed. */
  typeChanges: Record<string, number>
}

export type FileOutcome = {
  file: string
  name: string
  status: "ok" | "partial" | "failed"
  format: "envelope" | "flat" | "api-pages" | null
  kind: ExportKind | null
  runId: string | null
  runType: RunType | null
  /** Post window of an envelope, or the post date span of an older export. */
  window: Interval | null
  complete: boolean
  posts: PostCounts
  mentions: { received: number; new: number }
  inspiration: { received: number; new: number }
  snapshots: number
  removedSamples: number
  /** daily_stats dates rebuilt (settings timezone). */
  days: { from: string; to: string } | null
  /** Why it failed, why it was partial, or a warning. */
  reason: string | null
  /** True when the file stays where it is and the next import retries it. */
  retry: boolean
  movedTo: string | null
}

export type ImportReport = {
  result: ImportResult
  files: FileOutcome[]
  coverage: Coverage
  state: SyncStateRow
  settings: AppSettings
  /** Old processed/ files deleted (inbox imports only). */
  pruned: number
}

/** A file problem that won't fix itself: the file goes to failed/. */
class FileRejected extends Error {}

type Ctx = { settings: AppSettings; now: Date }

const ms = (iso: string) => Date.parse(iso)
const shortId = () => randomUUID().slice(0, 8)
const metricKeys = ["impressions", "likes", "replies", "reposts", "bookmarks", "quotes"] as const

const emptyCounts = (): PostCounts => ({ received: 0, new: 0, updated: 0, unchanged: 0, skipped: 0, typeChanges: {} })

function blankOutcome(file: string): FileOutcome {
  return {
    file,
    name: path.basename(file),
    status: "ok",
    format: null,
    kind: null,
    runId: null,
    runType: null,
    window: null,
    complete: false,
    posts: emptyCounts(),
    mentions: { received: 0, new: 0 },
    inspiration: { received: 0, new: 0 },
    snapshots: 0,
    removedSamples: 0,
    days: null,
    reason: null,
    retry: false,
    movedTo: null,
  }
}

function snapshotOf(p: Pick<Post, "id" | (typeof metricKeys)[number]>, takenAt: string) {
  return {
    postId: p.id,
    takenAt,
    impressions: p.impressions,
    likes: p.likes,
    replies: p.replies,
    reposts: p.reposts,
    quotes: p.quotes,
    bookmarks: p.bookmarks,
  }
}

/**
 * Upsert posts by id. Never overwrites a row fetched later than the incoming
 * copy. Writes a post_metric_snapshots row for new posts and for posts whose
 * numbers changed; the first change of a post stored before snapshots
 * existed also keeps its stored numbers as a baseline.
 */
async function upsertPosts(
  tx: Queryable,
  incoming: NewPost[],
  refreshReplies: SyncSettings["refreshReplies"],
  timeZone: string
) {
  const byId = new Map<string, NewPost>()
  for (const r of incoming) {
    const prev = byId.get(r.id)
    if (!prev || ms(r.fetchedAt) >= ms(prev.fetchedAt)) byId.set(r.id, r)
  }
  const rows = [...byId.values()]
  const counts = emptyCounts()
  counts.received = incoming.length
  counts.skipped = incoming.length - rows.length

  const existing = new Map<string, Post>()
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await tx.select().from(posts).where(inArray(posts.id, ids.slice(i, i + 500)))) existing.set(p.id, p)
  }

  const write: NewPost[] = []
  const snapshots: ReturnType<typeof snapshotOf>[] = []
  const firstChange: Post[] = []
  for (const r of rows) {
    const old = existing.get(r.id)
    if (!old) {
      counts.new++
      write.push(r)
      if (r.type !== "repost") snapshots.push(snapshotOf(r as Post, r.fetchedAt))
      continue
    }
    if (ms(old.fetchedAt) > ms(r.fetchedAt) || (refreshReplies === "new-only" && old.type === "reply")) {
      counts.skipped++
      continue
    }
    const metricsChanged = metricKeys.some((k) => old[k] !== r[k])
    const otherChanged =
      old.text !== r.text ||
      old.type !== r.type ||
      ms(old.createdAt) !== ms(r.createdAt) ||
      (r.conversationId != null && old.conversationId !== r.conversationId) ||
      old.repliedToId !== r.repliedToId ||
      old.quotedId !== r.quotedId ||
      old.repostedId !== r.repostedId
    if (old.type !== r.type) {
      const key = `${old.type} -> ${r.type}`
      counts.typeChanges[key] = (counts.typeChanges[key] ?? 0) + 1
    }
    if (metricsChanged || otherChanged) counts.updated++
    else counts.unchanged++
    write.push(r)
    if (metricsChanged && r.type !== "repost") {
      snapshots.push(snapshotOf(r as Post, r.fetchedAt))
      firstChange.push(old)
    }
  }

  if (firstChange.length > 0) {
    const hasHistory = new Set<string>()
    const changedIds = firstChange.map((p) => p.id)
    for (let i = 0; i < changedIds.length; i += 500) {
      const found = await tx
        .selectDistinct({ id: postMetricSnapshots.postId })
        .from(postMetricSnapshots)
        .where(inArray(postMetricSnapshots.postId, changedIds.slice(i, i + 500)))
      found.forEach((f) => hasHistory.add(f.id))
    }
    // Pushed after the new values, so a same-instant baseline loses the conflict.
    for (const old of firstChange) {
      if (!hasHistory.has(old.id)) snapshots.push(snapshotOf(old, normalizeIso(old.fetchedAt)))
    }
  }

  for (let i = 0; i < write.length; i += 100) {
    await tx
      .insert(posts)
      .values(write.slice(i, i + 100))
      .onConflictDoUpdate({
        target: posts.id,
        set: {
          createdAt: sql`excluded.created_at`,
          text: sql`excluded.text`,
          type: sql`excluded.type`,
          url: sql`excluded.url`,
          impressions: sql`excluded.impressions`,
          likes: sql`excluded.likes`,
          replies: sql`excluded.replies`,
          reposts: sql`excluded.reposts`,
          bookmarks: sql`excluded.bookmarks`,
          quotes: sql`excluded.quotes`,
          fetchedAt: sql`excluded.fetched_at`,
          // Some exports leave conversation_id blank; keep the stored one.
          conversationId: sql`coalesce(excluded.conversation_id, ${posts.conversationId})`,
          repliedToId: sql`excluded.replied_to_id`,
          quotedId: sql`excluded.quoted_id`,
          repostedId: sql`excluded.reposted_id`,
          accountId: sql`coalesce(excluded.account_id, ${posts.accountId})`,
        },
      })
  }
  for (let i = 0; i < snapshots.length; i += 200) {
    await tx.insert(postMetricSnapshots).values(snapshots.slice(i, i + 200)).onConflictDoNothing()
  }

  const dates = new Set(write.map((r) => dateKeyIn(new Date(r.createdAt), timeZone)))
  return { counts, snapshots: snapshots.length, dates }
}

/** Seed rows (scripts/seed.ts) go away with the first real import. */
async function removeSamples(tx: Queryable): Promise<number> {
  const removed = await tx
    .delete(posts)
    .where(or(like(posts.id, "sample-%"), like(posts.text, "[Sample]%")))
    .returning({ id: posts.id })
  if (removed.length > 0) await tx.delete(postMetricSnapshots).where(like(postMetricSnapshots.postId, "sample-%"))
  return removed.length
}

/** Rebuild daily_stats for the touched dates; everything when sample rows were removed (the seed writes sample days). */
async function rebuildDays(tx: Queryable, dates: Set<string>, removedSamples: number, timeZone: string) {
  if (removedSamples > 0) return rebuildAllDailyStats(tx, timeZone)
  if (dates.size === 0) return null
  const sorted = [...dates].sort()
  const range = { from: sorted[0], to: sorted.at(-1)! }
  await rebuildDailyStats(tx, range.from, range.to, timeZone)
  return range
}

async function upsertAccount(tx: Queryable, env: ExportEnvelope, fetchedAt: string, ctx: Ctx) {
  const a = env.account
  await tx
    .insert(accounts)
    .values({
      id: a.id,
      username: a.username,
      name: a.name ?? null,
      avatarUrl: a.profile_image_url ?? null,
      isPrimary: a.id === ctx.settings.userId,
      createdAt: ctx.now.toISOString(),
    })
    .onConflictDoUpdate({
      target: accounts.id,
      set: {
        username: a.username,
        name: sql`coalesce(excluded.name, ${accounts.name})`,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${accounts.avatarUrl})`,
        isPrimary: sql`max(excluded.is_primary, ${accounts.isPrimary})`,
      },
    })
  const pm = a.public_metrics
  if (pm && typeof pm.followers_count === "number") {
    await tx
      .insert(accountSnapshots)
      .values({
        accountId: a.id,
        takenAt: fetchedAt,
        followers: pm.followers_count,
        following: pm.following_count ?? 0,
        postsCount: pm.tweet_count ?? 0,
        listed: pm.listed_count ?? 0,
      })
      .onConflictDoNothing()
  }
}

async function upsertMentions(tx: Queryable, env: ExportEnvelope, fetchedAt: string) {
  const users = new Map((env.users ?? []).map((u) => [u.id, u]))
  const rows = [
    ...new Map(
      env.data
        // Own posts never belong in the replies inbox.
        .filter((p) => p.author_id && p.author_id !== env.account.id)
        .map((p) => [p.id, mentionFromApi(p, users, fetchedAt)])
    ).values(),
  ]
  let known = 0
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id)
    known += (await tx.select({ id: mentions.id }).from(mentions).where(inArray(mentions.id, ids))).length
  }
  for (let i = 0; i < rows.length; i += 100) {
    await tx
      .insert(mentions)
      .values(rows.slice(i, i + 100))
      .onConflictDoUpdate({
        target: mentions.id,
        // handled_at and reply_draft_id belong to the replies inbox; never touched here.
        set: {
          text: sql`excluded.text`,
          authorUsername: sql`coalesce(excluded.author_username, ${mentions.authorUsername})`,
          authorName: sql`coalesce(excluded.author_name, ${mentions.authorName})`,
          conversationId: sql`coalesce(excluded.conversation_id, ${mentions.conversationId})`,
          inReplyToId: sql`coalesce(excluded.in_reply_to_id, ${mentions.inReplyToId})`,
          likes: sql`excluded.likes`,
          replies: sql`excluded.replies`,
          reposts: sql`excluded.reposts`,
          impressions: sql`excluded.impressions`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`excluded.fetched_at >= ${mentions.fetchedAt}`,
      })
  }
  return { received: env.data.length, new: rows.length - known }
}

async function upsertInspiration(tx: Queryable, env: ExportEnvelope, fetchedAt: string) {
  const users = new Map((env.users ?? []).map((u) => [u.id, u]))
  const rows = [
    ...new Map(
      env.data.filter((p) => p.author_id).map((p) => [p.id, inspirationFromApi(p, users, fetchedAt)])
    ).values(),
  ]
  let known = 0
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((r) => r.id)
    known += (await tx.select({ id: inspirationPosts.id }).from(inspirationPosts).where(inArray(inspirationPosts.id, ids)))
      .length
  }
  for (let i = 0; i < rows.length; i += 100) {
    await tx
      .insert(inspirationPosts)
      .values(rows.slice(i, i + 100))
      .onConflictDoUpdate({
        target: inspirationPosts.id,
        // topic and saved are the user's; never touched here.
        set: {
          text: sql`excluded.text`,
          authorUsername: sql`coalesce(excluded.author_username, ${inspirationPosts.authorUsername})`,
          impressions: sql`excluded.impressions`,
          likes: sql`excluded.likes`,
          replies: sql`excluded.replies`,
          reposts: sql`excluded.reposts`,
          bookmarks: sql`excluded.bookmarks`,
          fetchedAt: sql`excluded.fetched_at`,
        },
        setWhere: sql`excluded.fetched_at >= ${inspirationPosts.fetchedAt}`,
      })
  }
  return { received: env.data.length, new: rows.length - known }
}

function describeError(e: unknown): string {
  if (typeof e === "string") return e.slice(0, 200)
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>
    const text = [o.title, o.detail, o.message].find((v) => typeof v === "string")
    if (typeof text === "string") return text.slice(0, 200)
  }
  return JSON.stringify(e)?.slice(0, 200) ?? "unknown error"
}

function incompleteReason(env: ExportEnvelope): string {
  if (env.rate_limited) return "Stopped early: Grok Bot hit its X read limit. The next run continues from the last complete sync."
  const first = env.errors[0]
  return `Stopped early${first === undefined ? "" : `: ${describeError(first)}`}. The next run continues from the last complete sync.`
}

async function importEnvelope(tx: Queryable, env: ExportEnvelope, out: FileOutcome, ctx: Ctx, startedAt: string) {
  const { settings } = ctx
  const fetchedAt = normalizeIso(env.fetched_at)
  const window = { from: normalizeIso(env.window.start_time), to: normalizeIso(env.window.end_time) }
  await upsertAccount(tx, env, fetchedAt, ctx)

  if (env.kind === "posts") {
    const own = env.data.filter((p) => !p.author_id || p.author_id === env.account.id)
    const rows = own.map((p) =>
      postFromApi(p, { fetchedAt, handle: settings.handle ?? env.account.username, accountId: env.account.id })
    )
    const res = await upsertPosts(tx, rows, settings.sync.refreshReplies, settings.timeZone)
    out.posts = { ...res.counts, received: env.data.length, skipped: res.counts.skipped + env.data.length - own.length }
    out.snapshots = res.snapshots
    out.removedSamples = await removeSamples(tx)
    // A complete window also vouches for its quiet days, so they're zero-filled.
    if (env.complete) {
      res.dates.add(dateKeyIn(new Date(window.from), settings.timeZone))
      res.dates.add(dateKeyIn(new Date(window.to), settings.timeZone))
    }
    out.days = await rebuildDays(tx, res.dates, out.removedSamples, settings.timeZone)
    out.window = window

    if (env.complete && isFullRefresh(window, settings.sync.fullRefreshDays)) {
      const day = dateKeyIn(new Date(window.to), settings.timeZone)
      const state = await readSyncState(tx)
      if (!state.lastFullRefreshDay || day > state.lastFullRefreshDay) await writeSyncState({ lastFullRefreshDay: day }, tx)
    }
  } else if (env.kind === "mentions") {
    out.mentions = await upsertMentions(tx, env, fetchedAt)
    // A partial fetch may have skipped older mentions; only a complete one moves the cursor.
    if (env.complete && env.data.length > 0) {
      const state = await readSyncState(tx)
      const newest = env.data.reduce<string | null>((acc, p) => maxId(acc, p.id), null)
      const next = maxId(state.lastMentionId, newest)
      if (next !== state.lastMentionId) await writeSyncState({ lastMentionId: next }, tx)
    }
  } else if (env.kind === "inspiration") {
    out.inspiration = await upsertInspiration(tx, env, fetchedAt)
  }

  out.status = env.complete ? "ok" : "partial"
  if (!env.complete) out.reason = incompleteReason(env)
  const run: NewSyncRun = {
    id: `${env.kind}-${env.run.id}-${shortId()}`,
    type: env.run.type,
    trigger: env.run.trigger,
    source: env.run.source,
    // Only post windows count as coverage (see lib/sync/state.ts).
    windowFrom: env.kind === "posts" ? window.from : null,
    windowTo: env.kind === "posts" ? window.to : null,
    complete: env.complete,
    status: out.status,
    postsReceived: out.posts.received,
    postsNew: out.posts.new,
    postsUpdated: out.posts.updated,
    error: out.reason,
    file: out.name,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
  await tx.insert(syncRuns).values(run)
}

async function importLegacy(tx: Queryable, legacy: LegacyFile, out: FileOutcome, ctx: Ctx, startedAt: string) {
  const { timeZone } = ctx.settings
  // A file someone exported by hand: store every reply too.
  const res = await upsertPosts(tx, legacy.posts, "all", timeZone)
  out.posts = res.counts
  out.snapshots = res.snapshots
  out.removedSamples = await removeSamples(tx)
  out.days = await rebuildDays(tx, res.dates, out.removedSamples, timeZone)
  const created = legacy.posts.map((p) => p.createdAt).sort()
  out.window = { from: created[0], to: legacy.fetchedAt > created.at(-1)! ? legacy.fetchedAt : created.at(-1)! }
  out.status = "ok"
  // Not an envelope, so it never counts as sync coverage (complete = false).
  await tx.insert(syncRuns).values({
    id: `file-${shortId()}`,
    type: "backfill",
    trigger: "cli",
    source: "file",
    windowFrom: out.window.from,
    windowTo: out.window.to,
    complete: false,
    status: "ok",
    postsReceived: out.posts.received,
    postsNew: out.posts.new,
    postsUpdated: out.posts.updated,
    error: null,
    file: out.name,
    startedAt,
    finishedAt: new Date().toISOString(),
  })
}

/** Best-effort run info from a file that failed validation, for the history row. */
function peekRun(raw: unknown) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const run = obj.run && typeof obj.run === "object" ? (obj.run as Record<string, unknown>) : {}
  const pick = <T extends string>(v: unknown, allowed: readonly T[]) =>
    allowed.includes(v as T) ? (v as T) : null
  return {
    kind: pick(obj.kind, exportKinds),
    runId: typeof run.id === "string" && /^[A-Za-z0-9._:-]{1,64}$/.test(run.id) ? run.id : null,
    runType: pick(run.type, syncRunTypes),
    trigger: pick(run.trigger, ["schedule", "webhook", "manual", "cli"] as const satisfies readonly RunTrigger[]),
    source: typeof run.source === "string" ? run.source.slice(0, 100) : null,
  }
}

/**
 * History row for a rejected file. When the file didn't say what it was, the
 * id starts with "unknown-" and `type` is only a placeholder; "file" as the
 * source stays reserved for older exports imported by hand.
 */
async function recordFailedRun(out: FileOutcome, startedAt: string, peek: ReturnType<typeof peekRun>, inbox: boolean) {
  await db.insert(syncRuns).values({
    id: `${out.kind ?? "unknown"}-${out.runId ?? "file"}-${shortId()}`,
    type: out.runType ?? "light",
    trigger: peek.trigger ?? (inbox ? "schedule" : "cli"),
    source: peek.source ?? (inbox ? "inbox" : "file"),
    windowFrom: null,
    windowTo: null,
    complete: false,
    status: "failed",
    error: out.reason,
    file: out.name,
    startedAt,
    finishedAt: new Date().toISOString(),
  })
}

async function importOne(file: string, ctx: Ctx): Promise<FileOutcome> {
  const out = blankOutcome(file)
  const inbox = isInInbox(file)
  const startedAt = new Date().toISOString()
  let peek = peekRun(null)
  let exists = true
  try {
    let size: number
    try {
      size = statSync(file).size
    } catch {
      exists = false
      throw new FileRejected(`File not found: ${file}`)
    }
    const tooBig = sizeProblem(size)
    if (inbox && tooBig) throw new FileRejected(tooBig)

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(file, "utf8"))
    } catch (err) {
      throw new FileRejected(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (looksLikeEnvelope(raw)) {
      peek = peekRun(raw)
      out.format = "envelope"
      out.kind = peek.kind
      out.runId = peek.runId
      out.runType = peek.runType
      const checked = validateEnvelope(raw, { sizeBytes: size, userId: ctx.settings.userId, now: ctx.now })
      if (!checked.ok) throw new FileRejected(checked.reason)
      const env = checked.envelope
      out.complete = env.complete
      if (!ctx.settings.userId) {
        ctx.settings = await updateSettings({
          userId: env.account.id,
          ...(ctx.settings.handle ? {} : { handle: env.account.username }),
        })
      }
      await db.transaction((tx) => importEnvelope(tx, env, out, ctx, startedAt))
    } else {
      if (inbox) {
        throw new FileRejected(
          'Inbox files must be xstats-export envelopes (format "xstats-export", version 1). ' +
            "Import older exports from another folder with `xstats import <file>`."
        )
      }
      const legacy = parseLegacy(raw, { handle: ctx.settings.handle, accountId: ctx.settings.userId, now: ctx.now })
      if (!legacy) throw new FileRejected("No posts found in this file.")
      if (legacy.userId && ctx.settings.userId && legacy.userId !== ctx.settings.userId) {
        throw new FileRejected(
          `This file is for X user id ${legacy.userId}, but this app is set up for user id ${ctx.settings.userId}.`
        )
      }
      out.format = legacy.format
      await db.transaction((tx) => importLegacy(tx, legacy, out, ctx, startedAt))
    }
  } catch (err) {
    out.status = "failed"
    if (err instanceof FileRejected) {
      out.reason = err.message
      if (inbox && exists) out.movedTo = moveToFailed(file, err.message, ctx.now)
    } else {
      // Not the file's fault (e.g. the database was busy): leave it for the next import.
      out.reason = `Not imported yet, will retry: ${err instanceof Error ? err.message : String(err)}`
      out.retry = true
    }
    if (exists) await recordFailedRun(out, startedAt, peek, inbox).catch(() => undefined)
    return out
  }

  if (inbox) {
    try {
      out.movedTo = moveToProcessed(file)
    } catch (err) {
      // Imported; re-importing it next time is harmless.
      out.reason = `Imported, but the file couldn't be moved to processed/: ${err instanceof Error ? err.message : String(err)}`
      out.retry = true
    }
  }
  return out
}

async function runImport(files: string[], now: Date): Promise<ImportReport> {
  const ctx: Ctx = { settings: await readSettings(), now }
  const outcomes: FileOutcome[] = []
  for (const file of files) outcomes.push(await importOne(file, ctx))
  const { settings } = ctx
  const backfillDays = settings.sync.backfillDays
  const imported = outcomes.filter((o) => o.status !== "failed")

  const update = async (q: Queryable) => {
    const state = await readSyncState(q)
    const coverage = computeCoverage({ lastOkTo: state.lastOkTo, windows: await coverageWindows(q), now, backfillDays })
    const patch: Partial<SyncStateRow> = {}
    if (coverage.lastOkTo !== state.lastOkTo) patch.lastOkTo = coverage.lastOkTo
    const backfillImported = imported.some((o) => o.complete && o.kind === "posts" && o.runType === "backfill")
    if (
      coversBackfill(coverage, now, backfillDays) &&
      (coverage.established || backfillImported || !state.backfillDoneAt)
    ) {
      patch.backfillDoneAt = now.toISOString()
    }
    if (imported.length > 0) await writeSyncState(patch, q)
    return { state: { ...state, ...patch }, coverage }
  }
  const { state, coverage } = imported.length > 0 ? await db.transaction(update) : await update(db)
  const next = nextFor(settings, state, coverage, nextRunAt(settings, now))

  const sum = (pick: (o: FileOutcome) => number) => imported.reduce((acc, o) => acc + pick(o), 0)
  const result: ImportResult = {
    status:
      outcomes.length === 0
        ? "empty"
        : imported.length === 0
          ? "failed"
          : outcomes.some((o) => o.status !== "ok")
            ? "partial"
            : "ok",
    runs: [...new Set(imported.map((o) => o.runId).filter((r): r is string => !!r))],
    posts: {
      received: sum((o) => o.posts.received),
      new: sum((o) => o.posts.new),
      updated: sum((o) => o.posts.updated),
    },
    mentions: { received: sum((o) => o.mentions.received), new: sum((o) => o.mentions.new) },
    gap: coverage.gap,
    next,
    failed: outcomes.filter((o) => o.status === "failed").map((o) => ({ file: o.name, reason: o.reason ?? "" })),
  }
  return { result, files: outcomes, coverage, state, settings, pruned: 0 }
}

export type ImportOptions = {
  now?: Date
  /** How long to wait for another import (worker or CLI) to finish. Default 60 s. */
  waitMs?: number
}

/**
 * Import the given files. Files inside the inbox are moved to processed/ or
 * failed/; files elsewhere stay where they are. Null when another import
 * held the lock for longer than `waitMs`.
 */
export function importFiles(files: string[], opts: ImportOptions = {}): Promise<ImportReport | null> {
  return withImportLock(() => runImport(files, opts.now ?? new Date()), { waitMs: opts.waitMs ?? 60_000 })
}

/** Import everything waiting in the inbox, then prune processed/. */
export function importInbox(opts: ImportOptions & { minAgeMs?: number } = {}): Promise<ImportReport | null> {
  return withImportLock(
    async () => {
      const now = opts.now ?? new Date()
      const report = await runImport(listInbox({ minAgeMs: opts.minAgeMs, now }), now)
      report.pruned = pruneProcessed(now)
      return report
    },
    { waitMs: opts.waitMs ?? 60_000 }
  )
}
