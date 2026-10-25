import type { Job } from "../types"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
/**
 * Daily database backup to data/backups (keep 7). Checks every hour, so a
 * computer that was off at the usual time still gets its backup on the
 * next start.
 */
const DAY_MS = 24 * 60 * 60_000

export const job: Job = {
  name: "backup",
  intervalMs: 60 * 60_000,
  runOnStart: true,
  async run(ctx) {
    const { createBackup, latestRegularBackup } = await import("../../lib/runtime/backup")
    const last = latestRegularBackup()
    // A little under a day, so the hourly check doesn't drift later each day.
    if (last && Date.now() - Date.parse(last.createdAt) < DAY_MS - 30 * 60_000) return
    const made = await createBackup("daily")
    const pruned = made.pruned.length ? `; removed ${made.pruned.length} old` : ""
    ctx.log(`saved ${made.name} (${(made.size / 1024 / 1024).toFixed(1)} MB)${pruned}`)
  },
}
