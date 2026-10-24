/** Parsed argv: positionals plus --flag / --flag value / --flag=value. */
export type Args = {
  positionals: string[]
  flags: Record<string, string | boolean>
}

/**
 * Output helper. With --json every command prints exactly one JSON object on
 * stdout (Grok Bot reads it); otherwise human text. Errors go to stderr.
 */
export type Output = {
  json: boolean
  /** Human-readable line (ignored in --json mode). */
  info(message: string): void
  /** Final result; printed as JSON in --json mode. */
  result(data: unknown, human?: string): void
  /** Print an error and exit non-zero. */
  fail(message: string, data?: unknown): never
}

export type Command = {
  name: string
  summary: string
  /** One line per flag, shown by `xstats help <name>`. */
  usage?: string[]
  run(args: Args, out: Output): Promise<void>
}
