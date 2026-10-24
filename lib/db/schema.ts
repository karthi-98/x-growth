import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

/** Post types shown on the dashboard (metrics, type split, Top posts). */
export const postTypes = ["original", "reply", "quote"] as const
export type PostType = (typeof postTypes)[number]

/**
 * Every type the `posts.type` column can hold. Reposts are stored for
 * completeness but excluded from all metrics, daily_stats and Top posts.
 */
export const storedPostTypes = [...postTypes, "repost"] as const
export type StoredPostType = (typeof storedPostTypes)[number]

/**
 * One row per post on X. `created_at` and `fetched_at` are ISO 8601 UTC
 * strings so real imports (API sync or archive) can upsert by `id`.
 */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    text: text("text").notNull(),
    type: text("type", { enum: storedPostTypes }).notNull().default("original"),
    url: text("url"),
    impressions: integer("impressions").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    bookmarks: integer("bookmarks").notNull().default(0),
    quotes: integer("quotes").notNull().default(0),
    fetchedAt: text("fetched_at").notNull(),
    /** Thread root id, when the source provides it. */
    conversationId: text("conversation_id"),
    /** referenced_tweets ids by relation, when present. */
    repliedToId: text("replied_to_id"),
    quotedId: text("quoted_id"),
    repostedId: text("reposted_id"),
    /** Owning account (accounts.id); null means the primary account. */
    accountId: text("account_id"),
  },
  (t) => [
    index("posts_created_at_idx").on(t.createdAt),
    index("posts_type_created_at_idx").on(t.type, t.createdAt),
  ]
)

/**
 * Account-level totals per calendar day (IST), keyed YYYY-MM-DD, summed from
 * stored originals, replies and quotes (reposts excluded).
 */
export const dailyStats = sqliteTable("daily_stats", {
  date: text("date").primaryKey(),
  posts: integer("posts").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  likes: integer("likes").notNull().default(0),
  replies: integer("replies").notNull().default(0),
  reposts: integer("reposts").notNull().default(0),
  bookmarks: integer("bookmarks").notNull().default(0),
})

/*
 * Tables below back the local-first app (docs/ARCHITECTURE.md section 7).
 * Timestamps are ISO 8601 UTC strings; JSON columns hold text parsed by the
 * owning module.
 */

/** Connected X accounts. v1 has exactly one, with is_primary = 1. */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
})

/** Profile counters per sync run, for follower growth. */
export const accountSnapshots = sqliteTable(
  "account_snapshots",
  {
    accountId: text("account_id").notNull(),
    takenAt: text("taken_at").notNull(),
    followers: integer("followers").notNull(),
    following: integer("following").notNull(),
    postsCount: integer("posts_count").notNull(),
    listed: integer("listed").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.takenAt] })]
)

/** A post's metrics at a point in time; written only when something changed. */
export const postMetricSnapshots = sqliteTable(
  "post_metric_snapshots",
  {
    postId: text("post_id").notNull(),
    takenAt: text("taken_at").notNull(),
    impressions: integer("impressions").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    quotes: integer("quotes").notNull().default(0),
    bookmarks: integer("bookmarks").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.takenAt] }),
    index("post_metric_snapshots_taken_at_idx").on(t.takenAt),
  ]
)

export const syncRunTypes = ["backfill", "full", "light", "catch-up"] as const
export const syncRunStatuses = ["ok", "partial", "failed", "skipped"] as const

/** One row per import (or skipped/failed attempt). */
export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: syncRunTypes }).notNull(),
    /** schedule | webhook | manual | cli */
    trigger: text("trigger").notNull(),
    /** grok-bot-x-connector | x-api | file */
    source: text("source").notNull(),
    windowFrom: text("window_from"),
    windowTo: text("window_to"),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: syncRunStatuses }).notNull(),
    postsReceived: integer("posts_received").notNull().default(0),
    postsNew: integer("posts_new").notNull().default(0),
    postsUpdated: integer("posts_updated").notNull().default(0),
    error: text("error"),
    file: text("file"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("sync_runs_started_at_idx").on(t.startedAt)]
)

/** Single row (id = 1): how far contiguous sync coverage reaches. */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  lastOkTo: text("last_ok_to"),
  lastFullRefreshDay: text("last_full_refresh_day"),
  backfillDoneAt: text("backfill_done_at"),
  lastMentionId: text("last_mention_id"),
})

/** Non-secret settings as key -> JSON value. Read through lib/settings.ts. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const draftKinds = ["post", "thread", "reply", "quote"] as const
export const draftStatuses = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "needs-check",
  "missed",
  "failed",
] as const
export type DraftStatus = (typeof draftStatuses)[number]

/** Compose / queue / publish history. `parts` is a JSON string[] (1 for a single post). */
export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: draftKinds }).notNull().default("post"),
    parts: text("parts").notNull(),
    inReplyToId: text("in_reply_to_id"),
    quoteId: text("quote_id"),
    scheduledAt: text("scheduled_at"),
    status: text("status", { enum: draftStatuses }).notNull().default("draft"),
    /** JSON string[] of created post ids, in part order. */
    publishedIds: text("published_ids"),
    error: text("error"),
    /** user | ai */
    origin: text("origin").notNull().default("user"),
    estCostUsd: real("est_cost_usd"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("drafts_status_scheduled_idx").on(t.status, t.scheduledAt)]
)

/** Posts mentioning or replying to the user (replies inbox). */
export const mentions = sqliteTable(
  "mentions",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull(),
    authorUsername: text("author_username"),
    authorName: text("author_name"),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
    conversationId: text("conversation_id"),
    inReplyToId: text("in_reply_to_id"),
    likes: integer("likes").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    fetchedAt: text("fetched_at").notNull(),
    handledAt: text("handled_at"),
    replyDraftId: text("reply_draft_id"),
  },
  (t) => [index("mentions_created_at_idx").on(t.createdAt)]
)

/** Other accounts' posts fetched for ideas (Phase 5). */
export const inspirationPosts = sqliteTable(
  "inspiration_posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull(),
    authorUsername: text("author_username"),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
    topic: text("topic"),
    impressions: integer("impressions").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    replies: integer("replies").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    bookmarks: integer("bookmarks").notNull().default(0),
    fetchedAt: text("fetched_at").notNull(),
    saved: integer("saved", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("inspiration_posts_fetched_at_idx").on(t.fetchedAt)]
)

/** Every AI call: usage, cost and whether the output was used. */
export const aiGenerations = sqliteTable("ai_generations", {
  id: text("id").primaryKey(),
  /** reply | rewrite | idea | thread | voice-profile | test */
  kind: text("kind").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estCostUsd: real("est_cost_usd").notNull().default(0),
  output: text("output"),
  accepted: integer("accepted", { mode: "boolean" }),
  createdAt: text("created_at").notNull(),
})

/** Every paid call (X writes/reads with the user's keys, AI). See lib/spend.ts. */
export const spendLedger = sqliteTable(
  "spend_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** x | ai */
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    units: integer("units").notNull().default(1),
    estCostUsd: real("est_cost_usd").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("spend_ledger_at_idx").on(t.at)]
)

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
/** A stored post narrowed to a dashboard type (never a repost). */
export type DashboardPost = Post & { type: PostType }
export type DailyStat = typeof dailyStats.$inferSelect
export type NewDailyStat = typeof dailyStats.$inferInsert
export type Account = typeof accounts.$inferSelect
export type SyncRun = typeof syncRuns.$inferSelect
export type NewSyncRun = typeof syncRuns.$inferInsert
export type Draft = typeof drafts.$inferSelect
export type NewDraft = typeof drafts.$inferInsert
export type Mention = typeof mentions.$inferSelect
export type InspirationPost = typeof inspirationPosts.$inferSelect
