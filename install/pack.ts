/**
 * Builds the release bundle for this computer's OS/arch from a finished
 * `bun run build` (docs/ARCHITECTURE.md section 9). CI runs it once per
 * platform (.github/workflows/release.yml).
 *
 *   bun install/pack.ts [--version x.y.z] [--out dist] [--keep-stage]
 *   bun install/pack.ts set-version x.y.z      (before `bun run build`)
 *
 * Writes <out>/x-growth-<version>-<platform>.zip (Windows) or .tar.gz and
 * adds its line to <out>/SHA256SUMS. The archive is the app folder itself:
 *   server.js, .next/, public/, node_modules/   Next's standalone server
 *   server-entry.mjs                           runs it under the launcher
 *   xstats.js, worker.js                       the CLI and worker, bundled
 *   drizzle/                                   migrations
 *   xstats.cmd | xstats                        shim that finds Bun
 *   release.json                               name, version, platform
 * Symlinks are copied as real files: Windows users can't create symlinks
 * without admin rights or Developer Mode, so an archive can't contain any.
 */
import { execSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { createArchive, parseSums, sha256File } from "../lib/runtime/archive"
import type { ReleaseInfo } from "../lib/runtime/layout"
import { platformId, platformIds, type PlatformId } from "../lib/runtime/platform"
import { assetName } from "../lib/runtime/releases"

const root = path.resolve(import.meta.dir, "..")
const at = (...p: string[]) => path.join(root, ...p)

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

function fail(message: string): never {
  console.error(`pack: ${message}`)
  process.exit(1)
}

const packageJsonPath = at("package.json")
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }

if (process.argv[2] === "set-version") {
  const version = process.argv[3]?.replace(/^v/, "")
  if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) fail(`set-version needs a version like 1.2.3 (got "${process.argv[3]}")`)
  writeFileSync(packageJsonPath, JSON.stringify({ ...pkg, version }, null, 2) + "\n")
  console.log(`package.json version set to ${version}`)
  process.exit(0)
}

const platform = (flag("platform") ?? platformId()) as PlatformId | null
if (!platform || !platformIds.includes(platform)) fail(`no bundle target for ${process.platform}-${process.arch}`)
if (platform !== platformId()) fail(`can only pack for this machine (${platformId()}); the native libSQL binary comes from node_modules`)
const version = (flag("version") ?? pkg.version).replace(/^v/, "")
const outDir = path.resolve(flag("out") ?? at("dist"))
const standalone = at(".next", "standalone")
if (!existsSync(path.join(standalone, "server.js"))) fail('no .next/standalone/server.js; run "bun run build" first (next.config.ts sets output: "standalone")')

// Releases are public. If a dynamic path in server code makes Next trace the
// whole project, the standalone folder gets data/ (database, keys) too.
const leaked = (dir: string, depth = 0): string[] => {
  if (depth > 6 || !existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === "node_modules" ? [] : e.name === "data" && depth === 0 ? [full] : leaked(full, depth + 1)
    return /^(secrets\.json|\.env.*|.*\.db|.*\.db-(wal|shm|journal))$/.test(e.name) ? [full] : []
  })
}
const leaks = leaked(standalone)
if (leaks.length) {
  fail(
    `.next/standalone holds files that must never ship:\n  ${leaks.slice(0, 10).join("\n  ")}\n` +
      'Usually a "whole project is traced" warning from "bun run build": fix that path (see /*turbopackIgnore: true*/ in lib/runtime) and rebuild.'
  )
}

const stage = path.join(outDir, ".stage", platform)
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
const copy = (from: string, to: string) => cpSync(from, to, { recursive: true, dereference: true, force: true })

console.log(`Packing x-growth ${version} for ${platform}`)

// 1. Next's standalone server, its static files and public/.
copy(standalone, stage)
copy(at(".next", "static"), path.join(stage, ".next", "static"))
if (existsSync(at("public"))) copy(at("public"), path.join(stage, "public"))
rmSync(path.join(stage, ".next", "cache"), { recursive: true, force: true })

// 2. @libsql/client with everything it loads, including this platform's native
//    binary. The server's trace has most of it; the CLI and worker need all of it.
function dependencyClosure(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return seen
  const manifest = at("node_modules", name, "package.json")
  if (!existsSync(manifest)) return seen // an optional dependency for another platform
  seen.add(name)
  const json = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, Record<string, string> | undefined>
  for (const dep of Object.keys({ ...json.dependencies, ...json.optionalDependencies })) dependencyClosure(dep, seen)
  return seen
}
const libsql = [...dependencyClosure("@libsql/client")]
for (const name of libsql) {
  const dest = path.join(stage, "node_modules", name)
  rmSync(dest, { recursive: true, force: true })
  copy(at("node_modules", name), dest)
}
const nativeBinary = libsql.find((n) => /^@libsql\/(win32|darwin|linux)-/.test(n))
if (!nativeBinary) fail("no native libSQL package (@libsql/<os>-<arch>) is installed")
console.log(`  libSQL: ${libsql.length} packages, native ${nativeBinary}`)

// 3. CLI and worker as single files. libSQL stays external (native binary).
const built = await Bun.build({
  entrypoints: [at("lib", "runtime", "entries", "xstats.ts"), at("lib", "runtime", "entries", "worker.ts")],
  outdir: stage,
  target: "bun",
  format: "esm",
  naming: "[name].[ext]",
  external: ["@libsql/*", "libsql"],
})
if (!built.success) fail(`bun build failed:\n${built.logs.map(String).join("\n")}`)
const outputs = built.outputs.map((o) => path.basename(o.path)).sort()
if (outputs.join(",") !== "worker.js,xstats.js") fail(`unexpected bundle outputs: ${outputs.join(", ")}`)

// 4. Launcher wrapper, migrations, shim, release.json.
copy(at("lib", "runtime", "server-entry.mjs"), path.join(stage, "server-entry.mjs"))
copy(at("drizzle"), path.join(stage, "drizzle"))
if (platform === "win-x64") {
  writeFileSync(
    path.join(stage, "xstats.cmd"),
    [
      "@echo off",
      "rem X Growth command line (Windows). Runs xstats.js from this folder with Bun.",
      "setlocal",
      'set "XG_BUN=%USERPROFILE%\\.bun\\bin\\bun.exe"',
      'for %%B in (bun.exe) do if not "%%~$PATH:B"=="" set "XG_BUN=%%~$PATH:B"',
      'if not exist "%XG_BUN%" (',
      "  echo Bun was not found. Install it from https://bun.sh and try again. 1>&2",
      "  exit /b 1",
      ")",
      "rem Kept on one line: cmd.exe re-reads a batch file after each command, and an update replaces this one.",
      '"%XG_BUN%" "%~dp0xstats.js" %* & call exit /b %%ERRORLEVEL%%',
      "",
    ].join("\r\n")
  )
} else {
  const shim = path.join(stage, "xstats")
  writeFileSync(
    shim,
    [
      "#!/bin/sh",
      "# X Growth command line (macOS/Linux). Runs xstats.js from this folder with Bun.",
      'dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      "bun=$(command -v bun 2>/dev/null || true)",
      '[ -n "$bun" ] || bun="$HOME/.bun/bin/bun"',
      'if [ ! -x "$bun" ]; then',
      '  echo "Bun was not found. Install it from https://bun.sh and try again." >&2',
      "  exit 1",
      "fi",
      'exec "$bun" "$dir/xstats.js" "$@"',
      "",
    ].join("\n")
  )
  chmodSync(shim, 0o755)
}
let commit: string | null = process.env.GITHUB_SHA ?? null
try {
  commit ??= execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
} catch {
  // Not a git checkout.
}
const release: ReleaseInfo = { name: "x-growth", version, platform, commit, builtAt: new Date().toISOString(), bun: Bun.version }
writeFileSync(path.join(stage, "release.json"), JSON.stringify(release, null, 2) + "\n")

// 5. Archive and checksum.
const archiveName = assetName(version, platform)
const archive = path.join(outDir, archiveName)
rmSync(archive, { force: true })
createArchive(stage, archive)
const hash = await sha256File(archive)
const sumsPath = path.join(outDir, "SHA256SUMS")
const sums = existsSync(sumsPath) ? parseSums(readFileSync(sumsPath, "utf8")) : new Map<string, string>()
sums.set(archiveName, hash)
writeFileSync(
  sumsPath,
  [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, h]) => `${h}  ${name}`)
    .join("\n") + "\n"
)
if (!process.argv.includes("--keep-stage")) rmSync(path.join(outDir, ".stage"), { recursive: true, force: true })

const sizeMb = (Bun.file(archive).size / 1024 / 1024).toFixed(1)
console.log(`  ${archive} (${sizeMb} MB)`)
console.log(`  sha256 ${hash}`)
