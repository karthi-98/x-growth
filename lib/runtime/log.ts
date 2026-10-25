import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"

import { runtimePaths } from "./paths"

/*
 * Append-only log files in data/logs with size-based rotation:
 * name.log -> name.1.log -> ... -> name.<keep>.log. Each write opens and
 * closes the file, so rotation is safe while other processes append too.
 * Never pass keys or tokens to these loggers.
 */

export const LOG_MAX_BYTES = 5 * 1024 * 1024
export const LOG_KEEP = 5

export type LogLevel = "info" | "warn" | "error"

export type Logger = {
  file: string
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  /** Child-process output: each line gets a timestamp. */
  raw(chunk: string | Uint8Array): void
}

export const logFile = (name: string) => path.join(runtimePaths.logs, `${name}.log`)

function rotate(file: string, keep: number) {
  const base = file.replace(/\.log$/, "")
  try {
    if (existsSync(`${base}.${keep}.log`)) unlinkSync(`${base}.${keep}.log`)
    for (let i = keep - 1; i >= 1; i--) {
      if (existsSync(`${base}.${i}.log`)) renameSync(`${base}.${i}.log`, `${base}.${i + 1}.log`)
    }
    renameSync(file, `${base}.1.log`)
  } catch {
    // Another process rotated it first, or a reader holds it; try again next write.
  }
}

/**
 * `name` becomes data/logs/<name>.log. With `echo`, lines also go to the
 * console (foreground runs); otherwise only to the file.
 */
export function createLogger(name: string, opts: { echo?: boolean; maxBytes?: number; keep?: number } = {}): Logger {
  const file = logFile(name)
  const maxBytes = opts.maxBytes ?? LOG_MAX_BYTES
  const keep = opts.keep ?? LOG_KEEP
  let size = -1
  let partial = ""

  const append = (text: string) => {
    try {
      if (size < 0) {
        mkdirSync(path.dirname(file), { recursive: true })
        size = existsSync(file) ? statSync(file).size : 0
      }
      if (size + text.length > maxBytes && size > 0) {
        rotate(file, keep)
        size = existsSync(file) ? statSync(file).size : 0
      }
      appendFileSync(file, text)
      size += Buffer.byteLength(text)
    } catch {
      // Logging must never take the process down (full disk, folder removed).
    }
  }

  const line = (level: LogLevel, message: string) => {
    const text = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}\n`
    append(text)
    if (opts.echo) (level === "info" ? console.log : console.error)(message)
  }

  return {
    file,
    info: (m) => line("info", m),
    warn: (m) => line("warn", m),
    error: (m) => line("error", m),
    raw(chunk) {
      const text = partial + (typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
      const lines = text.split(/\r?\n/)
      partial = lines.pop() ?? ""
      if (partial.length > 8192) {
        lines.push(partial)
        partial = ""
      }
      const stamp = new Date().toISOString()
      const out = lines.filter((l) => l.length > 0).map((l) => `${stamp} ${l}\n`)
      if (out.length) append(out.join(""))
      if (opts.echo) for (const l of lines) if (l) console.log(l)
    },
  }
}

/** Last `count` lines of a log, for error messages. */
export function tailLog(file: string, count = 20): string[] {
  try {
    return readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-count)
  } catch {
    return []
  }
}
