import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { runtimePaths } from "./paths"

/*
 * Launcher settings in data/runtime.json. Kept out of the settings table on
 * purpose: `xstats start` needs the port before the database exists (first
 * run) and without opening it.
 */

export const serverRuntimes = ["auto", "bun", "node"] as const
export type ServerRuntime = (typeof serverRuntimes)[number]

export type RuntimeConfig = {
  /** Port on 127.0.0.1 for the web app. */
  port: number
  /** What runs the Next server: Bun (default, see spike S6 in install/README.md) or Node. */
  runtime: ServerRuntime
}

export const DEFAULT_PORT = 3000

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = { port: DEFAULT_PORT, runtime: "auto" }

export const isValidPort = (n: number) => Number.isInteger(n) && n >= 1024 && n <= 65535

export function readRuntimeConfig(): RuntimeConfig {
  const out = { ...DEFAULT_RUNTIME_CONFIG }
  if (existsSync(runtimePaths.config)) {
    try {
      const stored = JSON.parse(readFileSync(runtimePaths.config, "utf8")) as Partial<RuntimeConfig>
      if (typeof stored.port === "number" && isValidPort(stored.port)) out.port = stored.port
      if (serverRuntimes.includes(stored.runtime as ServerRuntime)) out.runtime = stored.runtime as ServerRuntime
    } catch {
      // A corrupt file falls back to the defaults.
    }
  }
  return out
}

export function writeRuntimeConfig(patch: Partial<RuntimeConfig>): RuntimeConfig {
  const next = { ...readRuntimeConfig(), ...patch }
  mkdirSync(path.dirname(runtimePaths.config), { recursive: true })
  writeFileSync(runtimePaths.config, JSON.stringify(next, null, 2) + "\n")
  return next
}

/** http://127.0.0.1:<port> — the only address the server listens on. */
export const appUrl = (port: number) => `http://127.0.0.1:${port}`
