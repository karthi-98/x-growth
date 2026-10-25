import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import pkg from "../../package.json"

/*
 * Where the app's own files are. Two layouts:
 *   bundle  an installed release (release.json at the root, built by install/pack.ts)
 *   source  a git checkout (`bun run build` makes .next/standalone)
 * The data folder is separate in both (lib/paths.ts).
 */

export type Layout = {
  kind: "bundle" | "source"
  appDir: string
  /** Entry for `bun <cli> <command>` (handles --data-dir, see lib/runtime/bootstrap.ts). */
  cli: string
  /** Entry for the worker process. */
  worker: string
  /** Next's standalone server. */
  serverJs: string
  /** Wrapper that runs serverJs under the launcher (lib/runtime/server-entry.mjs). */
  serverEntry: string
  /** Drizzle migrations folder. */
  migrations: string
}

/** Written into every bundle by install/pack.ts. */
export type ReleaseInfo = {
  name: string
  version: string
  platform: string
  commit: string | null
  builtAt: string
  bun: string | null
}

const join = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ ...parts)

const isAppDir = (dir: string) =>
  existsSync(join(dir, "release.json")) || (existsSync(join(dir, "package.json")) && existsSync(join(dir, "cli", "xstats.ts")))

/**
 * The app folder: XSTATS_APP_DIR (set by the launcher for its children), else
 * the nearest app folder above the running script, else the working directory.
 */
export function findAppDir(): string {
  const fromEnv = process.env.XSTATS_APP_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  const starts = [process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : null, process.cwd()]
  for (const start of starts) {
    let dir = start
    for (let i = 0; dir && i < 4; i++) {
      if (isAppDir(dir)) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  return process.cwd()
}

export function getLayout(appDir: string = findAppDir()): Layout {
  if (existsSync(join(appDir, "release.json"))) {
    return {
      kind: "bundle",
      appDir,
      cli: join(appDir, "xstats.js"),
      worker: join(appDir, "worker.js"),
      serverJs: join(appDir, "server.js"),
      serverEntry: join(appDir, "server-entry.mjs"),
      migrations: join(appDir, "drizzle"),
    }
  }
  return {
    kind: "source",
    appDir,
    cli: join(appDir, "lib", "runtime", "entries", "xstats.ts"),
    worker: join(appDir, "lib", "runtime", "entries", "worker.ts"),
    serverJs: join(appDir, ".next", "standalone", "server.js"),
    serverEntry: join(appDir, "lib", "runtime", "server-entry.mjs"),
    migrations: join(appDir, "drizzle"),
  }
}

export function readRelease(appDir: string = findAppDir()): ReleaseInfo | null {
  try {
    return JSON.parse(readFileSync(join(appDir, "release.json"), "utf8")) as ReleaseInfo
  } catch {
    return null
  }
}

/** The running app's version: the bundle's release.json, else package.json. */
export function appVersion(appDir?: string): string {
  return readRelease(appDir)?.version ?? pkg.version
}

/** The folder that holds app/ and data/ for an installed bundle (e.g. %LOCALAPPDATA%\XGrowth). */
export const installRoot = (layout: Layout) => path.dirname(layout.appDir)
