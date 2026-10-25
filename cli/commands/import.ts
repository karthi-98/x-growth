import { existsSync } from "node:fs"
import path from "node:path"

import { CLI_NAME } from "../../lib/app"
import { paths } from "../../lib/paths"
import type { Command } from "../types"

// DB modules load lazily: the database can't open before `xstats setup` made the data folder.
export const command: Command = {
  name: "import",
  summary: "Import export files (a path, or --inbox) and print the result",
  usage: [
    `${CLI_NAME} import --inbox [--json]     import everything in data/inbox (what Grok Bot runs)`,
    `${CLI_NAME} import <file...> [--json]   import files; files outside the inbox stay where they are`,
    "--json prints the ImportResult: status, runs, posts, mentions, gap, next, failed",
  ],
  async run(args, out) {
    const inbox = args.flags.inbox === true
    if (!inbox && args.positionals.length === 0) return out.fail("Give a file to import, or --inbox.")
    if (!existsSync(paths.data)) {
      return out.fail(`No data folder at ${path.resolve(paths.data)}. Run "${CLI_NAME} setup" first.`)
    }
    const { importFiles, importInbox } = await import("../../lib/import")
    const { describeImport } = await import("../../lib/import/describe")
    const report = inbox ? await importInbox() : await importFiles(args.positionals)
    if (!report) return out.fail("Another import is still running. Try again in a minute.")
    out.result(report.result, describeImport(report))
    if (report.result.status === "failed") process.exitCode = 1
  },
}
