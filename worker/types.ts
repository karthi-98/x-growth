export type JobContext = {
  /** Aborted when the worker shuts down. */
  signal: AbortSignal
  log(message: string): void
}

/** A periodic job. Runs never overlap: the next tick waits for the previous run. */
export type Job = {
  name: string
  intervalMs: number
  /** Also run once right after the worker starts. */
  runOnStart?: boolean
  run(ctx: JobContext): Promise<void>
}
