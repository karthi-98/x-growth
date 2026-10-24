CREATE TABLE `account_snapshots` (
	`account_id` text NOT NULL,
	`taken_at` text NOT NULL,
	`followers` integer NOT NULL,
	`following` integer NOT NULL,
	`posts_count` integer NOT NULL,
	`listed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`account_id`, `taken_at`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`est_cost_usd` real DEFAULT 0 NOT NULL,
	`output` text,
	`accepted` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'post' NOT NULL,
	`parts` text NOT NULL,
	`in_reply_to_id` text,
	`quote_id` text,
	`scheduled_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_ids` text,
	`error` text,
	`origin` text DEFAULT 'user' NOT NULL,
	`est_cost_usd` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drafts_status_scheduled_idx` ON `drafts` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `inspiration_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`author_username` text,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`topic` text,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL,
	`fetched_at` text NOT NULL,
	`saved` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inspiration_posts_fetched_at_idx` ON `inspiration_posts` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`author_username` text,
	`author_name` text,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`conversation_id` text,
	`in_reply_to_id` text,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`fetched_at` text NOT NULL,
	`handled_at` text,
	`reply_draft_id` text
);
--> statement-breakpoint
CREATE INDEX `mentions_created_at_idx` ON `mentions` (`created_at`);--> statement-breakpoint
CREATE TABLE `post_metric_snapshots` (
	`post_id` text NOT NULL,
	`taken_at` text NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`quotes` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`post_id`, `taken_at`)
);
--> statement-breakpoint
CREATE INDEX `post_metric_snapshots_taken_at_idx` ON `post_metric_snapshots` (`taken_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spend_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`operation` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`est_cost_usd` real NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spend_ledger_at_idx` ON `spend_ledger` (`at`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`trigger` text NOT NULL,
	`source` text NOT NULL,
	`window_from` text,
	`window_to` text,
	`complete` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`posts_received` integer DEFAULT 0 NOT NULL,
	`posts_new` integer DEFAULT 0 NOT NULL,
	`posts_updated` integer DEFAULT 0 NOT NULL,
	`error` text,
	`file` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `sync_runs_started_at_idx` ON `sync_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_ok_to` text,
	`last_full_refresh_day` text,
	`backfill_done_at` text,
	`last_mention_id` text
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `account_id` text;