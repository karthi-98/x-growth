import type { Job } from "../types"

// Owner: sync workstream (docs/WORKSTREAMS.md). Replace this stub.
/** Import any export files waiting in data/inbox. */
export const job: Job = {
  name: "inbox",
  intervalMs: 30_000,
  runOnStart: true,
  async run() {},
}
