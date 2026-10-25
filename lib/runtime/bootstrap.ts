import { existsSync } from "node:fs"
import path from "node:path"

/*
 * Imported first by lib/runtime/entries/* (the CLI and worker entries that
 * release bundles and autostart run), before anything reads lib/paths.ts:
 *
 *   --data-dir <path>   use this data folder (autostart entries pass it;
 *                       a shortcut can't set environment variables).
 *                       Removed from argv so commands never see it.
 *   release.json next to the entry and no XSTATS_DATA_DIR
 *                       an installed bundle: data lives in <app>/../data,
 *                       outside the folder that updates replace.
 */

const argv = process.argv
const at = argv.findIndex((a, i) => i > 1 && (a === "--data-dir" || a.startsWith("--data-dir=")))
if (at > 1) {
  const inline = argv[at].startsWith("--data-dir=")
  const value = inline ? argv[at].slice("--data-dir=".length) : argv[at + 1]
  argv.splice(at, inline ? 1 : 2)
  if (value) process.env.XSTATS_DATA_DIR = path.resolve(value)
}

if (!process.env.XSTATS_DATA_DIR?.trim() && argv[1]) {
  const entryDir = path.dirname(path.resolve(argv[1]))
  if (existsSync(path.join(entryDir, "release.json"))) {
    process.env.XSTATS_DATA_DIR = path.join(path.dirname(entryDir), "data")
  }
}
