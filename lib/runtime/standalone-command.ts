import { command as uninstall } from "../../cli/commands/uninstall"
import { command as update } from "../../cli/commands/update"
import { makeOutput, parseArgs } from "../../cli/util"

/*
 * Runs `xstats update` or `xstats uninstall` with only their own modules
 * loaded (see lib/runtime/entries/xstats.ts). Same argument and output
 * handling as cli/xstats.ts.
 */

const [name, ...rest] = process.argv.slice(2)
const cmd = name === "uninstall" ? uninstall : update
const args = parseArgs(rest)
const out = makeOutput(args.flags.json === true)
try {
  await cmd.run(args, out)
} catch (err) {
  out.fail(err instanceof Error ? err.message : String(err))
}
