CREATE TABLE `daily_stats` (
	`date` text PRIMARY KEY NOT NULL,
	`posts` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`text` text NOT NULL,
	`type` text DEFAULT 'original' NOT NULL,
	`url` text,
	`impressions` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`replies` integer DEFAULT 0 NOT NULL,
	`reposts` integer DEFAULT 0 NOT NULL,
	`bookmarks` integer DEFAULT 0 NOT NULL,
	`quotes` integer DEFAULT 0 NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `posts_created_at_idx` ON `posts` (`created_at`);