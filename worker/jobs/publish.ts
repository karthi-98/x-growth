import { publishDue } from "../../lib/publish"
import { isXDryRun } from "../../lib/x/client"
import type { Job } from "../types"

/**
 * Publish due scheduled posts; flag missed and needs-check posts. The first
 * run after the worker starts is the startup recovery: drafts left in
 * `publishing` become needs-check, and posts that came due while the
 * computer was off either go out (late ≤ grace period) or become missed.
 */
export const job: Job = {
  name: "publish",
  intervalMs: 30_000,
  runOnStart: true,
  async run(ctx) {
    const s = await publishDue({ log: ctx.log })
    const report = [
      s.published.length && `published ${s.published.length}`,
      s.missed.length && `missed ${s.missed.length}`,
      s.needsCheck.length && `needs-check ${s.needsCheck.length}`,
      s.resolved.length && `resolved ${s.resolved.length}`,
      s.failed.length && `failed ${s.failed.length}`,
      s.held.length && `held ${s.held.length}`,
    ].filter(Boolean)
    if (report.length) ctx.log(`${report.join(", ")}${isXDryRun() ? " (dry run)" : ""}`)
  },
}
