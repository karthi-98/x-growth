# X Stats

Personal X (Twitter) analytics dashboard for @designwkarthick.
Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui + Drizzle ORM on SQLite, run with Bun.

> The database holds real posts imported from X (originals and quotes from the
> last 30 days; replies and reposts excluded). `scripts/seed.ts` can still load
> dummy data for development (ids start with `sample-`); a later import removes it.

## Run

```bash
bun install
bun run db:migrate   # create data/x-stats.db and apply drizzle/ migrations
bun run db:import data/imports/x-posts-2026-10-24.json   # upsert real posts, rebuild daily_stats
# or, for dummy data only:
bun run db:seed      # clear tables, insert 14 days + 30 sample posts (idempotent)
bun dev              # http://localhost:3000
```

Other scripts: `bun run db:generate` (new migration after editing `lib/db/schema.ts`),
`bun run lint`, `bun run typecheck`, `bun run build`.

## Layout

- `app/page.tsx` dashboard page (server component; data streams in under `<Suspense>`)
- `lib/db/schema.ts` Drizzle schema: `posts`, `daily_stats`
- `lib/db/client.ts` libSQL client (`file:data/x-stats.db`, override with `DATABASE_URL`)
- `lib/queries.ts` dashboard queries (last 7 days vs prior 7, IST)
- `components/dashboard/*` stat cards, impressions area chart, type donut, top posts table
- `app/transitions-tokens.css` transitions.dev motion tokens, `app/motion.css` app motion
- `drizzle/` generated SQL migrations, `scripts/` migrate + seed

## Database driver

Uses `@libsql/client` (prebuilt Windows binary) rather than `better-sqlite3`,
which needs a Visual Studio C++ toolchain to compile on Node 25 / Windows.
The same client works under Bun (scripts) and Node (`next dev`).

## Importing from X

`scripts/import-posts.ts` reads a saved X API v2 `GET /2/users/:id/tweets` response
(`{ data: [...] }`, an array of pages, or an array of posts) and:

- skips replies (`referenced_tweets` type `replied_to`, including self-thread replies) and reposts;
- types a post `quote` when it quotes another post, else `original`;
- deletes seed rows (`sample-%` posts and, if any existed, all daily_stats);
- upserts posts by id (metrics refreshed on conflict);
- rebuilds `daily_stats` for the covered IST dates by summing stored posts per day.
  These are originals and quotes only, using each post's lifetime metrics, so they are
  not X's account-level daily impressions.

Raw exports live in `data/imports/` (git-ignored). Impressions use
`non_public_metrics.impression_count` when present, else `public_metrics.impression_count`.

The dashboard shows the last 30 days (IST). The previous-period comparison chip only
appears when stored data reaches back over the full previous 30 days.
