ALTER TABLE `posts` ADD `conversation_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `replied_to_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `quoted_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `reposted_id` text;--> statement-breakpoint
CREATE INDEX `posts_type_created_at_idx` ON `posts` (`type`,`created_at`);