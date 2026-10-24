import type { AiProvider } from "@/lib/secrets"

import { AI_PROVIDERS } from "./models"

/*
 * Errors from AI calls, mapped to a few cases the UI can explain. Messages
 * are safe to show: they never contain the key.
 */

export const aiErrorCodes = [
  "no-key",
  "bad-key",
  "rate-limit",
  "no-credit",
  "bad-model",
  "bad-request",
  "refused",
  "spend-cap",
  "network",
  "provider",
] as const
export type AiErrorCode = (typeof aiErrorCodes)[number]

export class AiError extends Error {
  readonly code: AiErrorCode
  readonly status?: number

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message)
    this.name = "AiError"
    this.code = code
    this.status = status
  }
}

export const isAiError = (err: unknown): err is AiError => err instanceof AiError

const providerLabel = (p: AiProvider) => AI_PROVIDERS[p]?.label ?? p

/** Pull a human message out of any provider's error body. */
export function errorMessageOf(body: unknown): string {
  if (typeof body === "string") return body
  if (!body || typeof body !== "object") return ""
  const b = body as Record<string, unknown>
  const err = b.error
  if (typeof err === "string") return err
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>
    const parts = [e.message, e.type, e.code].filter((v) => typeof v === "string" && v)
    if (parts.length) return parts.join(" · ")
  }
  for (const k of ["message", "detail", "code"]) if (typeof b[k] === "string") return b[k] as string
  return ""
}

/** Remove the key (and long key-like tokens) from text before it is shown or logged. */
export function redact(text: string, apiKey?: string): string {
  let out = text
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join("[key]")
  return out.replace(/\b(sk|xai|sk-ant|sk-or)-[A-Za-z0-9_-]{12,}\b/g, "[key]")
}

// Not "billing" or "payment" alone: OpenAI's ordinary rate-limit message links to its billing page.
const CREDIT_RE =
  /credit|insufficient[_ ]quota|current quota|spend(ing)?[_ ]limit|usage[_ ]limit|exhausted|billing_error|payment required/i
const MODEL_RE = /model/i
const BAD_KEY_RE = /(api[ _-]?key|x-api-key|authorization|authenticat)/i

/** Map an HTTP failure from a provider to an AiError. */
export function classifyProviderError(
  provider: AiProvider,
  status: number,
  body: unknown,
  opts: { model?: string; retryAfter?: string | null; apiKey?: string } = {}
): AiError {
  const name = providerLabel(provider)
  const raw = redact(errorMessageOf(body), opts.apiKey).slice(0, 300)
  const detail = raw ? ` (${raw})` : ""

  const noCredit = () =>
    new AiError(
      "no-credit",
      `Your ${name} account is out of credits or hit its spending limit. Add credits in the ${name} console, then try again.`,
      status
    )
  const badKey = () =>
    new AiError("bad-key", `${name} rejected the API key. Check it in Settings → AI, or create a new key.`, status)
  const badModel = () =>
    new AiError(
      "bad-model",
      `${name} doesn't offer the model "${opts.model ?? "?"}" to this key. Pick another model in Settings → AI.`,
      status
    )

  if (status === 401) return badKey()
  if (status === 402) return noCredit()
  if (status === 429) {
    if (CREDIT_RE.test(raw)) return noCredit()
    const wait = Number(opts.retryAfter)
    const when = Number.isFinite(wait) && wait > 0 ? `in about ${Math.ceil(wait)}s` : "in a minute"
    return new AiError("rate-limit", `${name} is rate limiting requests. Try again ${when}.`, status)
  }
  if (status === 403) {
    if (CREDIT_RE.test(raw)) return noCredit()
    if (BAD_KEY_RE.test(raw)) return badKey()
    return new AiError("provider", `${name} refused the request${detail}.`, status)
  }
  if (status === 404) {
    if (MODEL_RE.test(raw)) return badModel()
    return new AiError("provider", `${name} returned "not found"${detail}.`, status)
  }
  if (status === 400 || status === 422) {
    // Anthropic reports a low balance as a 400; xAI reports a wrong key as a 400.
    if (CREDIT_RE.test(raw)) return noCredit()
    if (BAD_KEY_RE.test(raw) && /incorrect|invalid|missing|wrong/i.test(raw)) return badKey()
    if (MODEL_RE.test(raw) && /not (found|exist|available|supported)|invalid|unknown|does not/i.test(raw)) return badModel()
    return new AiError("bad-request", `${name} couldn't process the request${detail}.`, status)
  }
  if (status === 413) return new AiError("bad-request", `The text is too long for ${name}. Shorten it and try again.`, status)
  if (status >= 500) {
    return new AiError("provider", `${name} is having trouble right now (HTTP ${status}). Try again shortly.`, status)
  }
  return new AiError("provider", `${name} returned HTTP ${status}${detail}.`, status)
}
