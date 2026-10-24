/**
 * Long-running local worker (docs/ARCHITECTURE.md section 3): runs periodic
 * jobs while the computer is on. Started by `xstats start` next to the web
 * server; run alone with `bun run worker`.
 *
 * Jobs live in worker/jobs/<name>.ts, one owner per file (docs/WORKSTREAMS.md).
 */
import { job as backup } from "./jobs/backup"
import { job as inbox } from "./jobs/inbox"
import { job as publish } from "./jobs/publish"
import type { Job } from "./types"

const jobs: Job[] = [inbox, publish, backup]

const controller = new AbortController()
const log = (name: string) => (message: string) =>
  console.log(`[worker] ${new Date().toISOString()} ${name}: ${message}`)

function schedule(job: Job) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (controller.signal.aborted) return
    try {
      await job.run({ signal: controller.signal, log: log(job.name) })
    } catch (err) {
      log(job.name)(`failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (!controller.signal.aborted) timer = setTimeout(tick, job.intervalMs)
  }
  timer = setTimeout(tick, job.runOnStart ? 0 : job.intervalMs)
  controller.signal.addEventListener("abort", () => clearTimeout(timer))
}

for (const job of jobs) schedule(job)
console.log(`[worker] started ${jobs.length} jobs: ${jobs.map((j) => j.name).join(", ")}`)

const stop = () => {
  controller.abort()
  console.log("[worker] stopping")
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
