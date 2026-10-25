# Workstreams

The plan in [ARCHITECTURE.md](ARCHITECTURE.md) is built by six parallel workstreams. Each one has
its own branch and PR into `main`. The **foundation** commit already on `main` holds everything
they share: the full database schema and migration, settings, secrets, spend ledger, the bot↔app
contract types, the CLI and worker skeletons, the nav and the stub pages. That way streams don't
edit the same files.

## Who owns what

A stream only edits files it owns. Everything else is read-only for it, except the shared files
listed further down.

| Stream | Scope | Owns |
|---|---|---|
| **sync** | Phase 1: import pipeline, sync windows, CLI core, sync status | `lib/import/**`, `lib/sync/**`, `cli/commands/{setup,import,plan,status,doctor}.ts`, `worker/jobs/inbox.ts`, `components/app-shell/sync-status.tsx`, `components/settings/sync-section.tsx`, `components/sync/**`, `app/api/sync/**`, `scripts/import-posts.ts`, `scripts/seed.ts` |
| **runtime** | Phase 2 (local side): launcher, worker loop, autostart, backups, updates, release builds, setup wizard, localhost security | `cli/commands/{start,autostart,update,uninstall,backup}.ts`, `worker/index.ts`, `worker/jobs/backup.ts`, `lib/runtime/**`, `app/setup/**`, `components/setup/**`, `components/settings/app-section.tsx`, `proxy.ts` (or the Next 16 equivalent), `next.config.ts`, `.github/workflows/**`, `install/**` |
| **grokbot** | Phase 2 (bot side): the X Growth Bot's instructions, skills, routines, template guide, spike checklists, a bot simulator | `docs/grok-bot/**`, `scripts/simulate-bot.ts`, `fixtures/envelopes/**` |
| **compose** | Phase 3: X OAuth 1.0a client, compose, threads, schedule, queue, publish job, missed posts, X keys | `lib/x/**`, `lib/publish/**`, `worker/jobs/publish.ts`, `app/compose/**`, `app/queue/**`, `components/compose/**` (except `ai-assist.tsx`), `components/queue/**`, `components/settings/x-keys-section.tsx`, `components/settings/x-keys-form.tsx` |
| **ai** | Phase 4: AI providers, voice profile, AI assist in compose, replies inbox, AI key | `lib/ai/**`, `lib/voice/**`, `components/compose/ai-assist.tsx`, `app/replies/**`, `components/replies/**`, `components/settings/ai-section.tsx`, `components/settings/ai-key-form.tsx` |
| **analytics** | Timezone and settings wiring in analytics, follower growth, impressions per day, insights, General settings | `lib/queries.ts`, `lib/activity-query.ts`, `lib/posts-query.ts`, `lib/posts-params.ts`, `lib/range.ts`, `lib/range-links.ts`, `lib/pay-periods.ts`, `lib/format.ts`, `lib/donut.ts`, `lib/post-types.ts`, `lib/insights/**`, `app/page.tsx`, `app/posts/**`, `app/insights/**`, `components/dashboard/**`, `components/posts/**`, `components/range-filter/**`, `components/insights/**`, `components/settings/general-section.tsx` |

**Shared files.** Change these only when you must, keep the change small and additive, and say so
in the PR description:

- data and contract: `lib/db/schema.ts`, `drizzle/**`, `lib/settings.ts`, `lib/get-settings.ts`, `lib/secrets.ts`, `lib/spend.ts`, `lib/paths.ts`, `lib/dates.ts`, `lib/app.ts`, `lib/contract/envelope.ts`
- app structure: `lib/nav.ts`, `cli/xstats.ts`, `cli/util.ts`, `cli/types.ts`, `worker/types.ts`, `components/app-shell/**` (except `sync-status.tsx`), `app/layout.tsx`, `app/settings/page.tsx`
- project files: `package.json`, `bun.lock`, `eslint.config.mjs`, `tsconfig.json`, `README.md`, `docs/ARCHITECTURE.md`, `docs/WORKSTREAMS.md`

## How streams talk to each other

Only through these interfaces. Keep their signatures, and extend them only by adding to them.

| Interface | Provided by | Used by |
|---|---|---|
| `createPost()` and `verifyXKeys()` in `lib/x/client.ts` | compose | compose, and runtime's `/setup` through `XKeysForm` |
| **Replies and AI posts go through the `drafts` table**: insert `kind: "reply"` (or `"post"`), `status: "scheduled"`, `scheduledAt: now`, and the publish job sends it. No other stream calls X directly. | compose (publish job) | ai |
| `generateText()` and `verifyAiKey()` in `lib/ai/index.ts` | ai | ai, and runtime's `/setup` through `AiKeyForm` |
| `<AiAssist text onApply />` in `components/compose/ai-assist.tsx` | ai | compose (renders it next to the editor) |
| `<XKeysForm onSaved />` and `<AiKeyForm onSaved />` | compose / ai | settings sections, runtime's `/setup` |
| `ExportEnvelope` and `ImportResult` in `lib/contract/envelope.ts` | foundation | sync (validates and imports), grokbot (documents and simulates) |
| `<SyncStatus />` in the top bar | sync | app shell |
| `posts`, `account_snapshots`, `post_metric_snapshots`, `sync_runs` rows | sync writes | analytics reads |
| `recordSpend()` in `lib/spend.ts`, `readSecrets()` in `lib/secrets.ts`, `readSettings()` and `getSettings()` | foundation | everyone |
| Worker job files `worker/jobs/<name>.ts` | each owner | runtime's `worker/index.ts` loop |

## Rules for every stream

1. **Next.js 16 is newer than your training data.** Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (see `AGENTS.md`). The app uses `cacheComponents`: read the DB inside `Suspense`, after `await connection()`, as `lib/queries.ts` does.
2. **Schema changes:** avoid them, because the foundation migration already has every table from ARCHITECTURE.md section 7. If you really need one, make it one small migration (`bun run db:generate`), put **"[migration]"** in the PR title, and expect to regenerate it if another migration merges first.
3. **Dependencies:** prefer Bun and Node built-ins (`fetch`, `node:crypto` for OAuth 1.0a HMAC-SHA1, `node:fs`). If you add a package, say why in the PR.
4. **Timezone:** never hardcode IST. Use `settings.timeZone` with `dateKeyIn()` and `zonedDayStartUtc()` from `lib/dates.ts`.
5. **Money:** every paid call made with the user's keys records itself with `recordSpend()`. Show the estimated cost before spending.
6. **Keys:** never log them, never send them to the browser (show `maskSecret()`), never put them in files other than `data/secrets.json`.
7. **Tests:** `bun test` runs every file in one process. `test/setup.ts` (preloaded through `bunfig.toml`) gives them one shared, migrated temp data folder and database. Start each DB test file with `useTestDataDir()` (`lib/ai/testing/env.ts`), `useTempDatabase()` (`lib/publish/testing.ts`) or `resetTestData()` (`test/reset.ts`) in `beforeAll`. Never open your own database or close the shared client.
8. **Data for testing:** worktrees have no `data/x-stats.db`. Copy `D:\LaddderProjects\x-stats\data\x-stats.db` (the user's real data, already on migration 0002) into your worktree's `data/` folder. Never commit it. Real X exports for import tests are in `D:\LaddderProjects\x-stats\data\imports\`.
9. **Before opening the PR:** `bun run typecheck`, `bun run lint` and `bun run build` must pass, and the pages you touched must render (`bun dev` or `next start`). Open the PR against `main` on `karthi-98/x-growth`. Do not merge it.
