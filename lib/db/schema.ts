import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

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

export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
/** A stored post narrowed to a dashboard type (never a repost). */
export type DashboardPost = Post & { type: PostType }
export type DailyStat = typeof dailyStats.$inferSelect
export type NewDailyStat = typeof dailyStats.$inferInsert
