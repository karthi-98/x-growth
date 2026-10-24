import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { paths } from "./paths"

/*
 * The user's own keys, in data/secrets.json (never in the DB, never sent to
 * the browser, never logged, never shown to Grok Bot). Server-side only.
 * UI shows maskSecret() values. See docs/ARCHITECTURE.md sections 7 and 10.
 */

/** OAuth 1.0a user-context keys from the user's own X developer app (Read and Write). */
export type XKeys = {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

export const aiProviders = ["xai", "openai", "anthropic", "openrouter"] as const
export type AiProvider = (typeof aiProviders)[number]

export type AiKey = {
  provider: AiProvider
  apiKey: string
  /** Default model id for this provider. */
  model: string
}

export type Secrets = {
  x?: XKeys
  ai?: AiKey
  /** Bearer key for the Grok Bot "Sync now" webhook routine. */
  grokBotWebhookKey?: string
}

export function readSecrets(): Secrets {
  if (!existsSync(paths.secrets)) return {}
  try {
    return JSON.parse(readFileSync(paths.secrets, "utf8")) as Secrets
  } catch {
    return {}
  }
}

/** Merge and save. Pass `undefined` for a section to remove it. */
export function writeSecrets(patch: Partial<Secrets>): Secrets {
  const next: Secrets = { ...readSecrets(), ...patch }
  for (const k of Object.keys(next) as (keyof Secrets)[]) if (next[k] === undefined) delete next[k]
  mkdirSync(path.dirname(paths.secrets), { recursive: true })
  // 0600 on macOS/Linux; Windows ignores the mode (the file sits in the user's profile).
  writeFileSync(paths.secrets, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

/** "••••••a1B2" for display; empty string when unset. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return ""
  return `••••••${value.slice(-4)}`
}

export const hasXKeys = (s: Secrets = readSecrets()) =>
  !!(s.x?.apiKey && s.x.apiSecret && s.x.accessToken && s.x.accessTokenSecret)

export const hasAiKey = (s: Secrets = readSecrets()) => !!(s.ai?.apiKey && s.ai.provider)
