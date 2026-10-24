import path from "node:path"

/*
 * Where local data lives. Relative to the working directory (the project or
 * install root) unless XSTATS_DATA_DIR is absolute. Updates replace the app
 * folder, never this one. See docs/ARCHITECTURE.md section 9.
 */
export const DATA_DIR = process.env.XSTATS_DATA_DIR?.trim() || "data"

// Runtime data, not app code: keep Turbopack's file tracing out of it.
const inData = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ DATA_DIR, ...parts)

export const paths = {
  data: DATA_DIR,
  database: inData("x-stats.db"),
  /** Grok Bot drops export files here; the only place the bot writes. */
  inbox: inData("inbox"),
  processed: inData("processed"),
  failed: inData("failed"),
  backups: inData("backups"),
  secrets: inData("secrets.json"),
  logs: inData("logs"),
}
