import { KEEP_BACKUPS, createBackup, listBackups } from "../../lib/runtime/backup"
import type { Command } from "../types"
import { flagString } from "../util"

// Owner: runtime workstream (docs/WORKSTREAMS.md).
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export const command: Command = {
  name: "backup",
  summary: `Copy the database to data/backups (keeps the last ${KEEP_BACKUPS})`,
  usage: ["(no args)   make a backup now", "list        show existing backups", "--json      print one JSON object"],
  async run(args, out) {
    const sub = args.positionals[0]
    if (sub === "list") {
      const backups = listBackups()
      out.result(
        { status: "ok", backups },
        backups.length
          ? backups.map((b) => `${b.createdAt}  ${mb(b.size).padStart(8)}  ${b.kind.padEnd(10)}  ${b.path}`).join("\n")
          : "No backups yet."
      )
      return
    }
    if (sub !== undefined) out.fail(`Unknown backup subcommand "${sub}". Use "xstats backup" or "xstats backup list".`)

    // `--kind pre-update --label <version>` is how `xstats update` names its safety copy.
    const made = flagString(args, "kind") === "pre-update" ? await createBackup("pre-update", flagString(args, "label")) : await createBackup("manual")
    const pruned = made.pruned.length ? ` Removed ${made.pruned.length} old backup(s).` : ""
    out.result(
      { status: "ok", backup: { name: made.name, path: made.path, size: made.size, createdAt: made.createdAt }, pruned: made.pruned },
      `Backed up to ${made.path} (${mb(made.size)}).${pruned}`
    )
  },
}
