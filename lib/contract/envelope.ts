/*
 * The file format Grok Bot drops into data/inbox/ (docs/ARCHITECTURE.md
 * section 6.2) and the JSON `xstats import --json` prints back (section 6.3).
 * Types only, so the CLI, the import pipeline and docs share one definition.
 * The runtime validator lives with the import pipeline (lib/import/).
 */

export const EXPORT_FORMAT = "xstats-export"
export const EXPORT_VERSION = 1

export const exportKinds = ["posts", "mentions", "inspiration", "account"] as const
export type ExportKind = (typeof exportKinds)[number]

export type RunType = "backfill" | "full" | "light" | "catch-up"
export type RunTrigger = "schedule" | "webhook" | "manual" | "cli"

/** referenced_tweets entry from X API v2. */
export type ApiRef = { type: "replied_to" | "quoted" | "retweeted"; id: string }

export type ApiPublicMetrics = {
  impression_count?: number
  like_count?: number
  reply_count?: number
  retweet_count?: number
  quote_count?: number
  bookmark_count?: number
}

/** A post as returned by X API v2 (fields we request). */
export type ApiPost = {
  id: string
  text: string
  created_at: string
  author_id?: string
  conversation_id?: string
  in_reply_to_user_id?: string
  lang?: string
  referenced_tweets?: ApiRef[]
  public_metrics?: ApiPublicMetrics
  non_public_metrics?: { impression_count?: number }
}

/** A user as returned by X API v2. */
export type ApiUser = {
  id: string
  username: string
  name?: string
  profile_image_url?: string
  public_metrics?: {
    followers_count?: number
    following_count?: number
    tweet_count?: number
    listed_count?: number
  }
}

export type ExportEnvelope = {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  kind: ExportKind
  run: {
    id: string
    type: RunType
    trigger: RunTrigger
    /** e.g. "grok-bot-x-connector" */
    source: string
  }
  fetched_at: string
  account: ApiUser
  /** Inclusive start, exclusive end (UTC ISO). */
  window: { start_time: string; end_time: string }
  /** False when the bot stopped early (read limit, error); data is still imported. */
  complete: boolean
  rate_limited: boolean
  errors: unknown[]
  data: ApiPost[]
  /** Authors of posts in `data` (mentions/inspiration), from `includes.users`. */
  users?: ApiUser[]
}

/** What the next run should fetch; the bot keeps it in memory between runs. */
export type NextFetch = {
  type: RunType
  /** UTC ISO start of the window; end is "now" at fetch time. */
  from: string
  /** Fetch mentions newer than this id (null = last 7 days). */
  mentionsSinceId: string | null
}

/** Printed by `xstats import --inbox --json`. */
export type ImportResult = {
  status: "ok" | "partial" | "failed" | "empty"
  /** Run ids imported, in order. */
  runs: string[]
  posts: { received: number; new: number; updated: number }
  mentions: { received: number; new: number }
  /** An uncovered window the bot should fetch now (catch-up), or null. */
  gap: { from: string; to: string } | null
  next: NextFetch
  /** Files moved to failed/, with reasons. */
  failed: { file: string; reason: string }[]
}
