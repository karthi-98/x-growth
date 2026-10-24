import type { Args, Command, Output } from "./types"

export function parseArgs(argv: string[]): Args {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("--")) {
      positionals.push(a)
      continue
    }
    const [key, inline] = a.slice(2).split("=", 2)
    if (inline !== undefined) flags[key] = inline
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[key] = argv[++i]
    else flags[key] = true
  }
  return { positionals, flags }
}

export function makeOutput(json: boolean): Output {
  return {
    json,
    info(message) {
      if (!json) console.log(message)
    },
    result(data, human) {
      if (json) console.log(JSON.stringify(data))
      else console.log(human ?? JSON.stringify(data, null, 2))
    },
    fail(message, data) {
      if (json) console.log(JSON.stringify({ status: "failed", error: message, ...(data ? { data } : {}) }))
      else console.error(`Error: ${message}`)
      process.exit(1)
    },
  }
}

/** Placeholder for commands a workstream hasn't built yet. */
export function notImplemented(name: string, summary: string, owner: string): Command {
  return {
    name,
    summary,
    async run(_args, out) {
      out.fail(`"${name}" is not implemented yet (owner: ${owner}).`)
    },
  }
}

export const flagString = (args: Args, name: string): string | undefined => {
  const v = args.flags[name]
  return typeof v === "string" ? v : undefined
}
