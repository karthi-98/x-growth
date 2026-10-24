/**
 * xstats: the local CLI that Grok Bot and the user run.
 *
 *   bun run xstats <command> [args] [--json]
 *
 * Each command lives in cli/commands/<name>.ts (one owner per file, see
 * docs/WORKSTREAMS.md). With --json a command prints exactly one JSON object.
 */
import { APP_NAME, CLI_NAME } from "../lib/app"
import { command as autostart } from "./commands/autostart"
import { command as backup } from "./commands/backup"
import { command as doctor } from "./commands/doctor"
import { command as importCmd } from "./commands/import"
import { command as plan } from "./commands/plan"
import { command as setup } from "./commands/setup"
import { command as start } from "./commands/start"
import { command as status } from "./commands/status"
import { command as uninstall } from "./commands/uninstall"
import { command as update } from "./commands/update"
import type { Command } from "./types"
import { makeOutput, parseArgs } from "./util"

const commands: Command[] = [setup, importCmd, plan, status, doctor, start, autostart, backup, update, uninstall]

function help(name?: string) {
  const cmd = name ? commands.find((c) => c.name === name) : undefined
  if (cmd) {
    console.log(`${CLI_NAME} ${cmd.name}: ${cmd.summary}`)
    for (const line of cmd.usage ?? []) console.log(`  ${line}`)
    return
  }
  console.log(`${APP_NAME} CLI\n\nUsage: ${CLI_NAME} <command> [args] [--json]\n`)
  for (const c of commands) console.log(`  ${c.name.padEnd(10)} ${c.summary}`)
}

const [name, ...rest] = process.argv.slice(2)
if (!name || name === "help" || name === "--help") {
  help(rest[0])
  process.exit(0)
}
const cmd = commands.find((c) => c.name === name)
if (!cmd) {
  console.error(`Unknown command "${name}". Run "${CLI_NAME} help".`)
  process.exit(1)
}
const args = parseArgs(rest)
const out = makeOutput(args.flags.json === true)
try {
  await cmd.run(args, out)
} catch (err) {
  out.fail(err instanceof Error ? err.message : String(err))
}
