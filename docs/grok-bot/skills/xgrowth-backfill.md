# Skill: `xgrowth-backfill`

> **To install:** tell the bot "Save the text below the line as a skill named `xgrowth-backfill`",
> then paste it.

---

## When to use

- Right after `install-xgrowth`, to fill the app with the last 90 days.
- When the app's `next.type` is `"backfill"` (first sync, or the last good sync is more than
  90 days old). `xgrowth-sync` hands over to this skill.
- When the user asks to "refresh all X Growth data" (reread the whole 90 days to update old
  metrics).

It is `xgrowth-sync` with a long window: the same reads, file format and command, plus slicing
and chunking for thousands of posts, and a fallback for X's timeline cap.

## Inputs and approvals

**Needs** (from your state): `account.id`, `account.username`, `cli`, `inbox`, `os`, `timezone`.
Stop and say so if any is missing.

**Window:** `now` = current UTC time to the whole second. `from` = `next.from` when
`next.type` is `"backfill"`, otherwise `now − 90 days` (or the number of days the user asked for:
30, 90 or 180). The window is `[from, now)`. Expect about 70 posts a day for an active account:
roughly 6,000 posts for 90 days.

**Approvals:**
- Reading X needs none. Tell the user before you start: "Reading your last 90 days from X. This
  takes a while and uses about <estimate> reads."
- Writing and importing is **one** command, like a sync. In chat the approval waits for the user;
  in a routine it expires after about 10 minutes, and the run is then skipped (the next run
  starts the backfill again).
- If the user's computer rejects the command as too long, send **one file per command** (one
  approval each) and run the import only in the last one.

Run type: `"backfill"`. Trigger: `manual` in chat, `schedule` or `webhook` if a routine started it.

## X API calls

**a) Profile (1 read):**

```
GET /2/users/{account.id}?user.fields=public_metrics,profile_image_url
```

Keep `data` as `account` for every file. Note `account.public_metrics.tweet_count`.

**b) Posts, in slices of 7 days, oldest slice first.** Cut `[from, now)` into slices starting at
`from` (the last one is shorter). For each slice:

```
GET /2/users/{account.id}/tweets
    ?start_time={slice_start}&end_time={slice_end}
    &max_results=100
    &exclude=retweets
    &tweet.fields=created_at,public_metrics,referenced_tweets,conversation_id,in_reply_to_user_id,lang
```

Follow `meta.next_token` (as `pagination_token`) until no `next_token` comes back; an empty page
can still have one. Never use `exclude=replies`. If X rejects `tweet.fields`, send the same list
as `post.fields`.

**Oldest first matters:** if you hit the read limit, everything up to that point is a covered,
unbroken stretch from `from`, and the app's next `next` continues from there.

**c) X's timeline cap.** X documents that this endpoint only reaches an account's **3,200 most
recent posts**; beyond that it answers with no data and no error. So if a slice comes back
**empty** and `tweet_count` is above 3,200, check that slice once with full-archive search:

```
GET /2/tweets/search/all
    ?query=from:{account.username} -is:retweet
    &start_time={slice_start}&end_time={slice_end}
    &max_results=100
    &tweet.fields=created_at,public_metrics,referenced_tweets,conversation_id,in_reply_to_user_id,lang
```

(Search pages with `next_token` as a query parameter, not `pagination_token`. It allows about
one request per second.)

- Search returns posts: the cap is real. Use search for this slice **and every remaining slice**.
- Search returns nothing: the slice really is empty. Carry on with the timeline.
- Search isn't available to you (an error saying it isn't allowed): the older posts can't be
  reached. Drop this slice and all earlier ones, set `from` to the end of this slice, carry on
  with the timeline, and tell the user: "X only let me read back to <date>."

**d) Mentions:** the last 7 days, as in `xgrowth-sync` (`start_time = now − 7 days`, with
`expansions=author_id` and `user.fields=public_metrics,profile_image_url`). Fetch them after the
posts, and skip them if you hit a read limit.

## Read limits

On HTTP 429, or when the connector says the read limit, usage or credits ran out: stop at once
and keep what you have. Slices you finished are covered. The slice you were in, and anything after
it, are not. Write the files as below and import them: the app saves every post it gets and
records the run as `partial`, and its `next` starts where the covered stretch ends. Tell the user
when the limit resets if X said so. Retry other errors (5xx, timeouts) once per request, then
stop the same way, with `rate_limited: false` and the error in `errors`.

## Files

Same envelope as `xgrowth-sync` (format `xstats-export`, version 1), raw X objects, `account`
in every file, minified one-line JSON with non-ASCII escaped as `\uXXXX`.

**Chunking**, at most **1,000 posts per file**:

1. Take the posts from all finished slices, sorted by `created_at`, oldest first.
2. Cut them into groups of up to 1,000. Never split posts with the same `created_at` second.
3. Windows join up with no holes: the first file starts at `from`; each next file starts at the
   `created_at` of its first post; the last ends at the end of the last finished slice. These
   files are `complete: true`, `rate_limited: false`.
4. Posts from a slice you didn't finish go into one more file (or more, by 1,000), window
   `[that slice's start, now)`, `complete: false`, `rate_limited: true` if it was the read limit,
   and the error in `errors`. If the limit hit just as a slice started, that file has
   `"data": []`; write it anyway.
5. Run ids: `<runId>-01`, `<runId>-02`, … with `-01` the oldest, so sorting by name imports
   them oldest first. The mentions file uses the bare run id.

Example for 6,140 posts and a 90-day window from 26 Jul:

| File | Window | Posts | complete |
|---|---|---|---|
| `posts-20261024T110000Z-rb4k9q-01.json` | 26 Jul 11:00 → 9 Aug 14:02 | 1,000 | true |
| `posts-20261024T110000Z-rb4k9q-02.json` | 9 Aug 14:02 → 23 Aug 08:47 | 1,000 | true |
| … | … | … | … |
| `posts-20261024T110000Z-rb4k9q-07.json` | 22 Oct 09:15 → 24 Oct 11:00 | 140 | true |
| `mentions-20261024T110000Z-rb4k9q.json` | 17 Oct 11:00 → 24 Oct 11:00 | 212 | — |

**Check every file before asking:** valid JSON, `format` and `version` right, `account.id`
matches, `start_time` before `end_time`, at most 1,000 unique posts, under 20 MB, and the windows
of the `complete` files join with no holes.

## The command

One command writes every file (`<name>.part`, then rename) and runs `<cli> import --inbox --json`,
exactly as in `xgrowth-sync` step 6 (PowerShell on Windows, `sh` on macOS or Linux). Say first:
"Save 8 files (6,140 posts, 212 mentions) to the X Growth inbox and import them."

## After the import

Read the `ImportResult` as in `xgrowth-sync` step 7:

- Save `next` and `next_saved_at` in memory and in `/workspace/x-growth/state.json`.
- `ok`: the backfill is done.
- `partial`: tell the user how far it got. The routines continue the rest on their own (the
  app's `next` points at the missing part), or the user can say "continue the backfill" once the
  read limit resets.
- `failed`: report the reasons from `failed[]`; suggest `xgrowth-doctor`.
- `gap`: after a backfill there shouldn't be one. If there is, report it; don't loop.

## Validation and output

Report in the user's timezone, for example:

- "Backfill done: 6,140 posts from 26 Jul to today, plus 212 mentions from the last week. Your
  dashboard is ready at http://127.0.0.1:3000."
- "Backfill stopped at the X read limit after 3,200 posts (26 Jul → 2 Sep). It resets at 14:00;
  your next sync carries on from 2 Sep."
- "X only let me read back to 9 Sep, so your history starts there (2,960 posts)."

Update `last_run`. Never include post text or keys in the report.
