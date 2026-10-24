import { existsSync } from "node:fs"
import path from "node:path"

import { CLI_NAME } from "../../lib/app"
import { paths } from "../../lib/paths"
import type { Command } from "../types"
import { flagString } from "../util"

export const command: Command = {
  name: "plan",
  summary: "Print what the next sync should fetch (no import)",
  usage: [
    `${CLI_NAME} plan [--json]            the window a run started now should fetch`,
    "--at <ISO time>                   plan for another moment, e.g. the next reminder",
  ],
  async run(args, out) {
    if (!existsSync(paths.database)) {
      return out.fail(`No database at ${path.resolve(paths.database)}. Run "${CLI_NAME} setup" first.`)
    }
    const at = flagString(args, "at")
    const now = at ? new Date(at) : new Date()
    if (!Number.isFinite(now.getTime())) return out.fail(`--at must be an ISO time, got "${at}".`)

    const { getPlan } = await import("../../lib/sync/status")
    const { nextReminderAt } = await import("../../lib/sync/window")
    const { formatDateTime } = await import("../../lib/sync/format")
    const { settings, coverage, state, next } = await getPlan(now)
    const tz = settings.timeZone
    const reminder = nextReminderAt(now, settings.sync.reminderTimes, tz)
    const when = (iso: string) => formatDateTime(iso, tz)

    const human = [
      `Next run: ${next.type}`,
      `  fetch posts from ${when(next.from)} (${tz}) to the time of the fetch`,
      next.repliesFrom && next.repliesFrom !== next.from ? `  replies only from ${when(next.repliesFrom)}` : null,
      `  mentions ${next.mentionsSinceId ? `newer than ${next.mentionsSinceId}` : "from the last 7 days"}`,
      coverage.gap ? `Gap to fetch now (catch-up): ${when(coverage.gap.from)} to ${when(coverage.gap.to)}` : "Gap: none",
      `Coverage: ${coverage.live && coverage.since ? `${when(coverage.since)} to ${when(coverage.lastOkTo!)}` : "none yet (backfill needed)"}`,
      `Last full refresh: ${state.lastFullRefreshDay ?? "never"}`,
      `Next reminder: ${reminder ? when(reminder.toISOString()) : "none set"}`,
    ]
      .filter(Boolean)
      .join("\n")

    out.result(
      {
        status: "ok",
        next,
        gap: coverage.gap,
        coverage: {
          live: coverage.live,
          since: coverage.since,
          lastOkTo: coverage.lastOkTo,
          lastFullRefreshDay: state.lastFullRefreshDay,
          backfillDoneAt: state.backfillDoneAt,
        },
        nextReminderAt: reminder?.toISOString() ?? null,
        timeZone: tz,
      },
      human
    )
  },
}
