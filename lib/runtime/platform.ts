import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** Release bundle targets (docs/ARCHITECTURE.md section 9). */
export const platformIds = ["win-x64", "mac-arm64", "mac-x64", "linux-x64"] as const
export type PlatformId = (typeof platformIds)[number]

/** This machine's bundle target, or null when no bundle is built for it. */
export function platformId(platform: string = process.platform, arch: string = process.arch): PlatformId | null {
  if (platform === "win32" && arch === "x64") return "win-x64"
  if (platform === "darwin" && arch === "arm64") return "mac-arm64"
  if (platform === "darwin" && arch === "x64") return "mac-x64"
  if (platform === "linux" && arch === "x64") return "linux-x64"
  return null
}

export const archiveExtension = (p: PlatformId) => (p === "win-x64" ? "zip" : "tar.gz")

export const isWindows = process.platform === "win32"

/** First match for an executable on PATH (PATHEXT-aware on Windows). */
export function which(command: string): string | null {
  const exts = isWindows ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").toLowerCase().split(";")] : [""]
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      if (isWindows && ext === "" && !path.extname(command)) continue
      const candidate = path.join(/*turbopackIgnore: true*/ dir, command + ext)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** Bun's executable: this process when it runs under Bun, else PATH, else Bun's default install folder. */
export function bunPath(): string | null {
  if (process.versions.bun) return process.execPath
  const found = which("bun")
  if (found) return found
  const fallback = path.join(os.homedir(), ".bun", "bin", isWindows ? "bun.exe" : "bun")
  return existsSync(fallback) ? fallback : null
}

/** Node's executable, for the server fallback (spike S6). */
export function nodePath(): string | null {
  if (!process.versions.bun && process.versions.node) return process.execPath
  return which("node")
}
