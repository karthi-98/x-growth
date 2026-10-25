import { APP_NAME } from "@/lib/app"
import type { AiKey, AiProvider } from "@/lib/secrets"

import { AiError, classifyProviderError, redact } from "./errors"
import { AI_PROVIDERS, findModel } from "./models"

/*
 * One adapter per provider, plain fetch, no SDKs. Each turns the shared
 * request into the provider's HTTP call and reads back text and usage.
 * Nothing here touches the DB; lib/ai/index.ts logs and prices the call.
 *
 * - xAI and OpenAI: Responses API (POST /v1/responses)
 * - Anthropic: Messages API (POST /v1/messages, API version 2026-10-21)
 * - OpenRouter: Chat Completions (POST /api/v1/chat/completions)
 */

export type ChatMessage = { role: "user" | "assistant"; content: string }

export type ProviderRequest = {
  system: string
  messages: ChatMessage[]
  /** Cap on output tokens, including any reasoning the model does. */
  maxTokens: number
  /** Only sent to providers that accept it (xAI, OpenRouter). */
  temperature?: number
}

export type ProviderResult = {
  text: string
  /** Model that served the call (can differ from the requested one, e.g. a fallback). */
  model: string
  inputTokens: number
  outputTokens: number
  /** Cost the provider reported for this call, when it reports one. */
  reportedCostUsd: number | null
  /** Output stopped at maxTokens. */
  truncated: boolean
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export const ANTHROPIC_VERSION = "2026-10-21"
export const ANTHROPIC_FALLBACK_BETA = "server-side-fallback-2026-07-01"
const TIMEOUT_MS = 90_000

export const PROVIDER_URLS: Record<AiProvider, string> = {
  xai: "https://api.x.ai/v1/responses",
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
}

type HttpCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {})
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : [])

// ---------------------------------------------------------------- requests

function responsesCall(key: AiKey, req: ProviderRequest): HttpCall {
  const body: Record<string, unknown> = {
    model: key.model,
    instructions: req.system,
    input: req.messages.map((m) => ({ role: m.role, content: m.content })),
    max_output_tokens: req.maxTokens,
    // Don't keep prompts or outputs on the provider's side.
    store: false,
  }
  // OpenAI's reasoning models reject sampling settings; xAI accepts them.
  if (key.provider === "xai" && req.temperature !== undefined) body.temperature = req.temperature
  return {
    url: PROVIDER_URLS[key.provider],
    headers: { authorization: `Bearer ${key.apiKey}`, "content-type": "application/json" },
    body,
  }
}

function anthropicCall(key: AiKey, req: ProviderRequest): HttpCall {
  const info = findModel("anthropic", key.model)
  // API version 2026-10-21 rejects temperature/top_p/top_k on every model, so none are sent.
  const body: Record<string, unknown> = {
    model: key.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  }
  // Short social posts don't need deep thinking; keeps latency and cost down.
  if (info?.effort) body.output_config = { effort: "low" }
  const headers: Record<string, string> = {
    "x-api-key": key.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  }
  // Server-side fallback: if a safety classifier declines, the API retries on a fallback model.
  if (info?.fallbacks) {
    headers["anthropic-beta"] = ANTHROPIC_FALLBACK_BETA
    body.fallbacks = "default"
  }
  return { url: PROVIDER_URLS.anthropic, headers, body }
}

function openRouterCall(key: AiKey, req: ProviderRequest): HttpCall {
  const body: Record<string, unknown> = {
    model: key.model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    max_tokens: req.maxTokens,
  }
  if (req.temperature !== undefined) body.temperature = req.temperature
  return {
    url: PROVIDER_URLS.openrouter,
    headers: {
      authorization: `Bearer ${key.apiKey}`,
      "content-type": "application/json",
      "x-title": APP_NAME,
    },
    body,
  }
}

export function buildCall(key: AiKey, req: ProviderRequest): HttpCall {
  switch (key.provider) {
    case "xai":
    case "openai":
      return responsesCall(key, req)
    case "anthropic":
      return anthropicCall(key, req)
    case "openrouter":
      return openRouterCall(key, req)
  }
}

// --------------------------------------------------------------- responses

const refused = () => new AiError("refused", "The model declined to write this. Try rewording the text.")

function readResponses(key: AiKey, json: Record<string, unknown>): ProviderResult {
  const texts: string[] = []
  let refusal = false
  for (const item of arr(json.output)) {
    const it = obj(item)
    if (it.type !== "message") continue
    for (const part of arr(it.content)) {
      const p = obj(part)
      if (p.type === "output_text" && typeof p.text === "string") texts.push(p.text)
      if (p.type === "refusal") refusal = true
    }
  }
  if (!texts.length && typeof json.output_text === "string") texts.push(json.output_text)
  if (!texts.length && refusal) throw refused()
  const usage = obj(json.usage)
  // xAI reports the exact cost; OpenAI doesn't.
  const nano = usage.cost_in_nano_usd
  return {
    text: texts.join("").trim(),
    model: typeof json.model === "string" ? json.model : key.model,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    reportedCostUsd: typeof nano === "number" && Number.isFinite(nano) ? nano / 1e9 : null,
    truncated: json.status === "incomplete" && obj(json.incomplete_details).reason === "max_output_tokens",
  }
}

function readAnthropic(key: AiKey, json: Record<string, unknown>): ProviderResult {
  // Content can hold thinking and fallback blocks too; only text is the answer.
  const text = arr(json.content)
    .map(obj)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim()
  if (json.stop_reason === "refusal") throw refused()
  const usage = obj(json.usage)
  return {
    text,
    model: typeof json.model === "string" ? json.model : key.model,
    inputTokens:
      num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens),
    outputTokens: num(usage.output_tokens),
    reportedCostUsd: null,
    truncated: json.stop_reason === "max_tokens",
  }
}

function readOpenRouter(key: AiKey, json: Record<string, unknown>): ProviderResult {
  const choice = obj(arr(json.choices)[0])
  const message = obj(choice.message)
  if (choice.finish_reason === "error" || choice.error) {
    const err = obj(choice.error)
    throw classifyProviderError("openrouter", num(err.code) || 502, { error: err }, { model: key.model, apiKey: key.apiKey })
  }
  const content = message.content
  const text =
    typeof content === "string"
      ? content
      : arr(content)
          .map(obj)
          .filter((p) => typeof p.text === "string")
          .map((p) => p.text as string)
          .join("")
  if (!text.trim() && (choice.finish_reason === "content_filter" || typeof message.refusal === "string")) throw refused()
  const usage = obj(json.usage)
  const cost = usage.cost
  return {
    text: text.trim(),
    model: typeof json.model === "string" ? json.model : key.model,
    inputTokens: num(usage.prompt_tokens),
    outputTokens: num(usage.completion_tokens),
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    truncated: choice.finish_reason === "length",
  }
}

// -------------------------------------------------------------------- call

/** Send one request to the user's provider. Throws AiError with a message safe to show. */
export async function callProvider(
  key: AiKey,
  req: ProviderRequest,
  fetchImpl: FetchLike = fetch
): Promise<ProviderResult> {
  const call = buildCall(key, req)
  let res: Response
  try {
    res = await fetchImpl(call.url, {
      method: "POST",
      headers: call.headers,
      body: JSON.stringify(call.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
    const label = AI_PROVIDERS[key.provider].label
    throw new AiError(
      "network",
      timedOut
        ? `The request to ${label} timed out. Try again.`
        : `Couldn't reach ${label}. Check your internet connection and try again.`
    )
  }

  const raw = await res.text()
  let json: unknown = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = redact(raw, key.apiKey).slice(0, 300)
  }

  if (!res.ok) {
    throw classifyProviderError(key.provider, res.status, json, {
      model: key.model,
      retryAfter: res.headers.get("retry-after"),
      apiKey: key.apiKey,
    })
  }
  const body = obj(json)
  // OpenRouter can return an error object with HTTP 200.
  if (body.error && !body.choices && !body.output && !body.content) {
    const code = num(obj(body.error).code) || 502
    throw classifyProviderError(key.provider, code, body, { model: key.model, apiKey: key.apiKey })
  }

  switch (key.provider) {
    case "xai":
    case "openai":
      return readResponses(key, body)
    case "anthropic":
      return readAnthropic(key, body)
    case "openrouter":
      return readOpenRouter(key, body)
  }
}
