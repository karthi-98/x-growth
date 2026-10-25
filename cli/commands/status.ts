import { existsSync } from "node:fs"
import path from "node:path"

import { CLI_NAME } from "../../lib/app"
import { paths } from "../../lib/paths"
import type { Command } from "../types"

export const command: Command = {
  name: "status",
  summary: "Show last sync, coverage, data counts and app health",
  usage: [`${CLI_NAME} status [--json]`],
  async run(_args, out) {
    if (!existsSync(paths.database)) {
      return out.fail(`No database at ${path.resolve(paths.database)}. Run "${CLI_NAME} setup" first.`)
    }
    const { sql } = await import("drizzle-orm")
    const { db } = await import("../../lib/db/client")
    const schema = await import("../../lib/db/schema")
    const { getSyncStatus } = await import("../../lib/sync/status")
    const { listFailed, listInbox } = await import("../../lib/import/files")
    const { formatDateTime, timeAgo } = await import("../../lib/sync/format")

    const now = new Date()
    const status = await getSyncStatus(now)
    const tz = status.timeZone
    const count = async (table: Parameters<typeof sql>[1]) =>
      Number((await db.get<{ n: number }>(sql`select count(*) as n from ${table}`))?.n ?? 0)
    const [{ min, max }] = await db
      .select({ min: sql<string | null>`min(${schema.dailyStats.date})`, max: sql<string | null>`max(${schema.dailyStats.date})` })
      .from(schema.dailyStats)
    const counts = {
      posts: await count(schema.posts),
      mentions: await count(schema.mentions),
      accountSnapshots: await count(schema.accountSnapshots),
      metricSnapshots: await count(schema.postMetricSnapshots),
      syncRuns: await count(schema.syncRuns),
      dailyStats: min && max ? { from: min, to: max } : null,
    }
    const inbox = { waiting: listInbox().length, failed: listFailed().length }
    const run = status.lastRun
    const when = (iso: string) => formatDateTime(iso, tz)
    const num = (n: number) => n.toLocaleString("en-US")
    const { coverage } = status

    const healthText: Record<typeof status.health, string> = {
      never: "Not synced yet. Ask Grok Bot to run the X Growth backfill.",
      ok: "OK",
      partial: "The last sync stopped early; the next one continues from the last complete sync.",
      backfill: "Backfill not finished yet.",
      stale: `No complete sync for over ${status.staleAfterHours}h. Grok Bot may have paused the X Growth routines: open Grok Bot and resume them.`,
      failing: `The last import failed: ${run?.error ?? "unknown error"}`,
    }

    out.result(
      {
        status: "ok",
        health: status.health,
        syncedAt: status.syncedAt,
        stale: status.stale,
        lastRun: run
          ? {
              id: run.id,
              type: run.type,
              trigger: run.trigger,
              status: run.status,
              complete: run.complete,
              window: run.windowFrom && run.windowTo ? { from: run.windowFrom, to: run.windowTo } : null,
              posts: { received: run.postsReceived, new: run.postsNew, updated: run.postsUpdated },
              error: run.error,
              file: run.file,
              finishedAt: run.finishedAt,
            }
          : null,
        coverage: {
          live: status.coverage.live,
          since: status.coverage.since,
          lastOkTo: status.coverage.lastOkTo,
          gap: status.coverage.gap,
          backfillDoneAt: status.state.backfillDoneAt,
          lastFullRefreshDay: status.state.lastFullRefreshDay,
          lastMentionId: status.state.lastMentionId,
        },
        next: status.next,
        nextReminderAt: status.nextReminderAt,
        counts,
        inbox,
        timeZone: tz,
      },
      [
        `Health: ${healthText[status.health]}`,
        status.syncedAt
          ? `Synced: ${timeAgo(status.syncedAt, now)} (complete up to ${when(status.syncedAt)}, ${tz})`
          : "Synced: never",
        run
          ? `Last import: ${run.status} ${run.type} run, ${timeAgo(run.finishedAt ?? run.startedAt, now)}` +
            (run.postsReceived ? `, ${num(run.postsReceived)} posts (${num(run.postsNew)} new)` : "")
          : "Last import: none",
        coverage.live && coverage.since
          ? `Coverage: ${when(coverage.since)} to ${when(coverage.lastOkTo!)}`
          : "Coverage: none (backfill needed)",
        coverage.gap ? `Gap: ${when(coverage.gap.from)} to ${when(coverage.gap.to)}` : null,
        `Next reminder: ${status.nextReminderAt ? when(status.nextReminderAt) : "none set"}; ` +
          `a run now would be ${status.next.type} from ${when(status.next.from)}`,
        `Data: ${num(counts.posts)} posts, ${num(counts.mentions)} mentions, ` +
          `${num(counts.accountSnapshots)} profile snapshots, ${num(counts.metricSnapshots)} metric snapshots` +
          (counts.dailyStats ? `; daily stats ${counts.dailyStats.from} to ${counts.dailyStats.to}` : ""),
        `Inbox: ${inbox.waiting} waiting, ${inbox.failed} in failed/`,
      ]
        .filter(Boolean)
        .join("\n")
    )
  },
}
