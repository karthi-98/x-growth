import { existsSync } from "node:fs"

import { paths } from "../../lib/paths"
import type { Job } from "../types"

/** Files this fresh may still be being written by the bot. */
const MIN_FILE_AGE_MS = 10_000

/**
 * Import any export files waiting in data/inbox. Usually Grok Bot runs
 * `xstats import --inbox` itself; this catches files it dropped without
 * importing (approval expired, command failed). Skips while another import
 * holds the lock.
 */
export const job: Job = {
  name: "inbox",
  intervalMs: 30_000,
  runOnStart: true,
  async run({ log }) {
    if (!existsSync(paths.database)) return
    const { listInbox } = await import("../../lib/import/files")
    if (listInbox({ minAgeMs: MIN_FILE_AGE_MS }).length === 0) return
    const { importInbox } = await import("../../lib/import")
    const { describeImport } = await import("../../lib/import/describe")
    const report = await importInbox({ minAgeMs: MIN_FILE_AGE_MS, waitMs: 0 })
    if (!report || report.result.status === "empty") return
    log(describeImport(report))
  },
}
