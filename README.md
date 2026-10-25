# X Growth

A local-first X (Twitter) growth app: analytics, scheduling and AI writing that run entirely on
your own computer. **Grok Bot** installs it, reads your X data and keeps it fresh several times a
day. Your own X API keys are used only to post, and your own AI key only to write.

- Plan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Who builds what: [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md)

Stack: Next.js 16 (App Router, Cache Components) + TypeScript + Tailwind v4 + shadcn/ui, Drizzle ORM
on SQLite through `@libsql/client`, run with Bun.

## Run (development)

```bash
bun install
bun run db:migrate                     # create data/x-stats.db and apply drizzle/ migrations
bun run db:import <export.json>        # import an X API export (being replaced by `xstats import`)
bun dev                                # http://localhost:3000
```

Other scripts:

| Command | Does |
|---|---|
| `bun run xstats help` | Local CLI used by Grok Bot and you (setup, import, plan, status, doctor, start, …) |
| `bun run worker` | Background jobs: inbox import, publish queue, backups |
| `bun run xstats start` | After `bun run build`: the production server on 127.0.0.1 plus the worker, as installed copies run it (`--detach` for the background, `xstats stop` to stop) |
| `bun run db:generate` | Create a new migration after editing `lib/db/schema.ts` |
| `bun run lint` / `bun run typecheck` / `bun run build` | Checks |

Installing, updates, backups and release builds: [install/README.md](install/README.md).

## Data

Everything lives in `data/`, which is git-ignored:

- `x-stats.db`: posts, daily stats, sync runs, drafts and settings
- `inbox/`: export files dropped by Grok Bot
- `secrets.json`: your keys

The dashboard and the Posts page include originals, replies and quotes; reposts are stored but
never counted. Daily totals currently add up each post's lifetime numbers on the day it was posted.
Snapshots will turn these into real impressions-per-day.

## Database driver

Uses `@libsql/client` (prebuilt Windows binary) rather than `better-sqlite3`, which needs a Visual
Studio C++ toolchain to compile on Windows. The same client works under Bun (CLI, worker) and Node
(`next`).
