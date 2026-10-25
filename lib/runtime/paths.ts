import path from "node:path"

import { paths } from "../paths"

/*
 * Files the launcher, worker and updater keep in the data folder. Everything
 * here survives app updates (docs/ARCHITECTURE.md section 9).
 */

// Runtime data, not app code: keep Turbopack's file tracing out of it.
const inData = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ paths.data, ...parts)

export const runtimePaths = {
  /** Locks, stop requests and worker status. */
  run: inData("run"),
  /** Held by `xstats start` while it runs; JSON LauncherState. */
  launcherLock: inData("run", "xstats.lock"),
  /** Held by the worker process. */
  workerLock: inData("run", "worker.lock"),
  /** Held by `xstats update` so two updates never overlap. */
  updateLock: inData("run", "update.lock"),
  /** Written by `xstats stop` (and update/uninstall); the launcher polls for it. */
  stopRequest: inData("run", "stop-request"),
  /** Per-job last run / last error, written by the worker. */
  workerStatus: inData("run", "worker-status.json"),
  /** Port and server runtime (see lib/runtime/config.ts). */
  config: inData("runtime.json"),
  /** Downloaded release archives. */
  updates: inData("updates"),
  logs: paths.logs,
  backups: paths.backups,
}

/** The data folder as an absolute path, for child processes whose cwd differs. */
export const absoluteDataDir = () => path.resolve(/*turbopackIgnore: true*/ paths.data)
