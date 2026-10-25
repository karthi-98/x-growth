import { existsSync, readdirSync, rmdirSync } from "node:fs"
import path from "node:path"

import { APP_NAME } from "../../lib/app"
import { disableAutostart } from "../../lib/runtime/autostart"
import { removeDir, stopLauncher } from "../../lib/runtime/instance"
import { getLayout, installRoot } from "../../lib/runtime/layout"
import { absoluteDataDir } from "../../lib/runtime/paths"
import type { Command } from "../types"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
export const command: Command = {
  name: "uninstall",
  summary: "Remove autostart; keep data unless --purge",
  usage: [
    "(no args)   stop the app, remove autostart and the installed app folder; your data stays",
    "--purge     also delete the data folder (database, backups, keys, logs); needs --yes",
    "--yes       confirm --purge",
    "--json      print one JSON object",
  ],
  async run(args, out) {
    const layout = getLayout()
    const dataDir = absoluteDataDir()
    const purge = args.flags.purge === true
    if (purge && args.flags.yes !== true) {
      out.fail(`--purge deletes ${dataDir} for good (database, backups, keys and logs). Run it again with --purge --yes to confirm.`)
    }

    const stopped = await stopLauncher()
    const autostart = disableAutostart()

    // Never delete a source checkout; an installed bundle's app folder is ours.
    const targets: string[] = []
    if (layout.kind === "bundle") {
      const root = installRoot(layout)
      targets.push(layout.appDir, ...["app.new", "app.old", "app.failed"].map((d) => path.join(root, d)).filter((d) => existsSync(d)))
    }
    if (purge) targets.push(dataDir)
    // Step out of anything we are about to delete (Windows refuses to delete a working directory).
    process.chdir(path.dirname(layout.kind === "bundle" ? installRoot(layout) : dataDir))

    const removed: string[] = []
    const scheduled: string[] = []
    for (const dir of targets) (removeDir(dir) === "removed" ? removed : scheduled).push(dir)
    if (layout.kind === "bundle") {
      const root = installRoot(layout)
      try {
        if (existsSync(root) && readdirSync(root).length === 0) rmdirSync(root)
      } catch {
        // Not empty yet (scheduled deletions); leave it.
      }
    }

    const kept = purge ? null : dataDir
    const lines = [
      stopped.wasRunning ? "Stopped the app." : `${APP_NAME} wasn't running.`,
      autostart.enabled ? "Could not remove autostart." : "Removed autostart.",
      ...removed.map((d) => `Deleted ${d}`),
      ...scheduled.map((d) => `Deleting ${d} in a few seconds (it was still in use).`),
      kept ? `Kept your data in ${kept} (delete it with "xstats uninstall --purge --yes").` : "Deleted your data.",
      layout.kind === "source" ? "This is a source checkout, so its files were left alone." : "",
      "Bun stays installed; remove it separately if nothing else uses it.",
    ].filter(Boolean)
    out.result(
      { status: "uninstalled", stopped: stopped.wasRunning, autostart: autostart.enabled, removed, scheduled, kept },
      lines.join("\n")
    )
  },
}
