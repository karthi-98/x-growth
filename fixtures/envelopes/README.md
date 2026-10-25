# Envelope fixtures

Example files in the format the X Growth Bot drops into `data/inbox/`: `ExportEnvelope`
version 1 from [`lib/contract/envelope.ts`](../../lib/contract/envelope.ts), described in
[ARCHITECTURE.md](../../docs/ARCHITECTURE.md) section 6.2 and the bot's
[`xgrowth-sync`](../../docs/grok-bot/skills/xgrowth-sync.md) skill.

**Everything here is synthetic.** The repo is public: never add real posts, handles, ids or
metrics. For tests with real data, use `bun run simulate-bot` (below), whose output stays in the
git-ignored `data/` folder.

The synthetic account is **@xgrowth_demo**, id `1000000000000000001`, timezone
`Asia/Kolkata`. Other accounts (`1000000000000000002` to `…004`) appear as reply targets and
mention authors. Post ids are snowflake-style, so they sort by time like real ones. Files are
pretty-printed for reading; the bot writes the same JSON minified on one line. Non-ASCII text is
escaped as `\uXXXX`, as the bot writes it (see "Café ☕" and "🚀").

## Valid files (`valid/`)

They tell one story. Install on 17 Oct at 08:00 local (02:30 UTC), then three of the four
reminders on 24 Oct.

| File | Run | Window (UTC) | Posts | Shows |
|---|---|---|---|---|
| `posts-20261017T023000Z-rb4k9q-01.json` | backfill, chunk 1 of 2 | 19 Jul 02:30 → 2 Sep 16:20:44 | 4 | A chunk window that ends where the next chunk's first post starts |
| `posts-20261017T023000Z-rb4k9q-02.json` | backfill, chunk 2 of 2 | 2 Sep 16:20:44 → 17 Oct 02:30 | 4 | Chunks join with no hole; non-ASCII escaped |
| `posts-20261024T023000Z-rf8m2x.json` | full (08:00), schedule | 17 Oct 02:30 → 24 Oct 02:30 | 7 | First run of the day: 7 days, joins the backfill; an X `errors` entry passed through as is |
| `posts-20261024T073000Z-rl3c7d.json` | light (13:00), schedule | 23 Oct 07:30 → 24 Oct 07:30 | 5 | 3 posts again with **newer** metrics, 2 new |
| `mentions-20261024T073000Z-rl3c7d.json` | same light run | 23 Oct 07:30 → 24 Oct 07:30 | 3 | `kind: "mentions"` with `users` from `includes.users`; shares the run id |
| `posts-20261024T123000Z-rp5t1z.json` | light (18:00), schedule | 23 Oct 12:30 → 24 Oct 12:30 | 2 | Read limit: `complete: false`, `rate_limited: true`, a 429 in `errors` |

Real chunks hold up to 1,000 posts; these hold 4 so they stay readable.

Every post has the fields the bot requests (`created_at`, `public_metrics`, `conversation_id`,
`lang`, and `referenced_tweets` / `in_reply_to_user_id` on replies and quotes) plus
`edit_history_tweet_ids`, which X always adds. Originals, replies and quotes are all there; no
reposts, since the bot fetches with `exclude=retweets`.

### Expected import

With settings `userId = 1000000000000000001` and an empty database, copying `valid/*` into
`data/inbox/` and running `bun run xstats import --inbox --json` should give:

- **Posts:** 22 received, 19 new, 3 updated (the light run's newer metrics win; the full run's
  older numbers never overwrite them, whatever the import order).
- **Mentions:** 3 received, 3 new. `next.mentionsSinceId` is the newest mention's id.
- **Coverage:** `last_ok_to` = `2026-10-24T07:30:00Z`. The backfill chunks, the full run and the
  light run join up; the partial run is saved but doesn't move it.
- **Runs:** the 18:00 run is recorded as `partial`, the others `ok`, so the overall `status`
  should be `"partial"`.
- **`gap`:** null. **`next`:** a light refresh from about `2026-10-24T06:30:00Z` if imported on
  24 Oct (local), otherwise a full refresh.

**Gap check:** import only the two backfill chunks, then only the light file. The light window
starts after `last_ok_to` (17 Oct 02:30), so the result should report a gap from about 17 Oct
02:30 to 23 Oct 07:30, and `last_ok_to` must not move.

## Invalid files (`invalid/`)

Each should be moved to `data/failed/` with a matching `.error.txt` and listed in the result's
`failed` array. Nothing from them may reach the database.

| File | Problem |
|---|---|
| `posts-20261024T163000Z-rbadversion.json` | `version: 2` |
| `posts-20261024T163000Z-rbadaccount.json` | `account.id` is `1000000000000000999`, not the configured user |
| `posts-20261024T163000Z-rbadformat.json` | `format` is `x-export` |
| `posts-20261024T163000Z-rbadtruncated.json` | Cut off mid-file (what a failed transfer looks like): not valid JSON |
| *generated:* `posts-20261024T023000Z-rbadsize.json` | Over the 20 MB limit (21.7 MB). Too big to commit: run `bun fixtures/envelopes/make-oversized.ts`, which writes it to `data/fixtures/` |

## Making files from a real export

`scripts/simulate-bot.ts` applies the bot's rules (7-day slices oldest first, files of at most
1,000 posts whose windows join, reposts dropped, `.part` then rename, `\uXXXX` escapes) to a raw
X API export or a flat export:

```bash
bun run simulate-bot data/imports/x-posts-2026-10-24.json --type light
bun run simulate-bot data/imports/posts-since-2026-06-01.json --type backfill --account-id <your id>
bun run simulate-bot <export> --type backfill --partial          # stops halfway, like a read limit
bun run simulate-bot <export> --type catch-up --from 2026-10-20T00:00:00Z --to 2026-10-22T00:00:00Z
bun run simulate-bot <export> --kind mentions --type full
bun run xstats import --inbox --json
```

All flags are listed at the top of `scripts/simulate-bot.ts`. Output goes to `data/inbox/` (or
`--out <dir>`), which is git-ignored.
