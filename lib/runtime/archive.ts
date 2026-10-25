import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, existsSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"

import { isWindows } from "./platform"

/*
 * Release archives: .zip for Windows, .tar.gz elsewhere, plus a SHA256SUMS
 * file. Uses the tar that ships with every supported OS (Windows 10+ has
 * bsdtar in System32, which also reads and writes zip), so no extra
 * dependency is needed.
 */

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

/** `<hex>  <name>` lines (sha256sum format; a leading `*` marks binary mode). */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m) sums.set(m[2], m[1].toLowerCase())
  }
  return sums
}

/** Windows' own bsdtar (Git for Windows puts a GNU tar without zip support earlier on PATH). */
function tarBin(): string {
  if (!isWindows) return "tar"
  const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  return existsSync(system) ? system : "tar"
}

function runTar(args: string[]) {
  const r = spawnSync(tarBin(), args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`tar ${args[0]} failed: ${(r.stderr || r.stdout || "").trim().slice(0, 2000)}`)
}

export function extractArchive(archive: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  if (archive.endsWith(".zip") && !isWindows) {
    const r = spawnSync("unzip", ["-q", "-o", archive, "-d", dest], { encoding: "utf8" })
    if (r.status !== 0) throw new Error(`unzip failed: ${(r.stderr || r.error?.message || "").trim()}`)
    return
  }
  runTar(["-xf", archive, "-C", dest])
}

/** Archive the contents of `srcDir` (no top-level folder) as .zip or .tar.gz, by `out`'s extension. */
export function createArchive(srcDir: string, out: string) {
  const entries = readdirSync(srcDir)
  if (out.endsWith(".zip")) runTar(["-a", "-c", "-f", out, "-C", srcDir, ...entries])
  else runTar(["-czf", out, "-C", srcDir, ...entries])
}
