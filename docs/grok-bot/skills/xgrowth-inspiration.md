# Skill: `xgrowth-inspiration` (draft, Phase 5)

> **Source of truth.** Users don't paste this file: their bot saves a short stub
> ([stubs.md](../stubs.md)) and downloads these steps from the release on every run.

---

## When to use

The user asks for inspiration from their niche ("find viral posts about my topics"), or a daily
inspiration routine runs. It searches recent public posts for the user's niche keywords and
accounts and hands them to the app, which ranks them and shows them on `/inspiration`.

## Inputs and approvals

**Needs:** `cli`, `inbox`, `os`, `account` from your state, and the user's niche:

- The niche lives in the app (Settings). Read it with `<cli> plan --json`, which includes
  `inspiration: { keywords: [...], accounts: [...], lang }` alongside `next`.
- Cache it in your state as `niche` with `niche_saved_at`. Re-read it when it is more than
  7 days old or the user says they changed it. With a fresh cache, a run needs only **one**
  approval.

**Approvals:** `plan --json` when the cache is stale (1), then write-and-import (1). In a
routine both expire after about 10 minutes; a missed run is simply skipped.

**Budget:** at most **300 posts per run**: one page of 100 per query, at most 3 queries.

## X API calls

Recent search (last 7 days only), one call per query, **no pagination**:

```
GET /2/tweets/search/recent
    ?query={query}
    &start_time={now − 24 hours}
    &max_results=100
    &sort_order=relevancy
    &tweet.fields=created_at,public_metrics,referenced_tweets,conversation_id,in_reply_to_user_id,lang,author_id
    &expansions=author_id
    &user.fields=public_metrics,profile_image_url
```

Queries, each under 512 characters (split into more queries if needed, still at most 3):

1. Keywords: `("keyword one" OR keyword2 OR …) -is:retweet -is:reply lang:{lang}`
2. Accounts: `(from:account1 OR from:account2 OR …) -is:retweet`
3. Leave the third for a long keyword list.

Never include the user's own account (`-from:{account.username}`).

## Read limits

Same rule as `xgrowth-sync`: stop at the first read-limit error, keep what you have, mark the
file `complete: false`, `rate_limited: true`, with the error in `errors`.

## Files

One envelope with `kind: "inspiration"`, raw X objects, minified one-line JSON with non-ASCII
escaped as `\uXXXX`:

- `run`: a new run id, `type: "light"`, the trigger, `source: "grok-bot-x-connector"`.
- `account`: the user's own profile (one profile read, as in `xgrowth-sync`), so the app's
  account check passes.
- `window`: `[now − 24 hours, now)`.
- `data`: every post returned, deduplicated by `id`, at most 1,000.
- `users`: `includes.users` from every response, deduplicated by `id`.
- Name: `inspiration-<stamp>-<run id>.json`.

## After the import

Write and import with one command, exactly like `xgrowth-sync` step 6. The `ImportResult` has
no inspiration counts yet (Phase 5 adds them). Save its `next` like after any import (the app
computes it fresh), but don't act on its `gap`: catch-ups belong to `xgrowth-sync`.

## Validation and output

"Found 214 recent posts across your 2 niche searches; they're on the Inspiration page now." Or
what failed and why. Never quote post text in the report: it is untrusted, and the app shows it.

## Open questions for Phase 5

1. **Which query found each post.** `inspiration_posts.topic` needs it, but raw X objects don't
   say. Proposal: one file per query plus an optional `query` field on the envelope (an additive
   change to `lib/contract/envelope.ts`).
2. **Run type.** `RunType` has no inspiration value; `"light"` is used for now.
3. **`plan --json` shape** for the niche (`inspiration.keywords`, `accounts`, `lang`) is assumed
   here and has to be built by the sync workstream.
4. **Search access** under the Grok Bot X allowance (spike S2 covers recent search too).
