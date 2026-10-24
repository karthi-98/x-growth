import type { Job } from "../types"

// Owner: runtime workstream (docs/WORKSTREAMS.md). Replace this stub.
/** Daily database backup to data/backups (keep 7). */
export const job: Job = {
  name: "backup",
  intervalMs: 60 * 60_000,
  runOnStart: true,
  async run() {},
}
