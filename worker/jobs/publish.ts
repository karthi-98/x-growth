import type { Job } from "../types"

// Owner: compose workstream (docs/WORKSTREAMS.md). Replace this stub.
/** Publish due scheduled posts; flag missed and needs-check posts. */
export const job: Job = {
  name: "publish",
  intervalMs: 30_000,
  runOnStart: true,
  async run() {},
}
