import type { AiProvider } from "@/lib/secrets"

/*
 * Providers, suggested models and token prices for estimates. No server
 * imports, so client components (the key form, AI assist) can use it.
 * Prices are USD per 1M tokens from each provider's pricing page, Oct 2026:
 * docs.x.ai/docs/models, developers.openai.com/api/docs/pricing,
 * the Claude API model table, and openrouter.ai (which also reports the
 * real cost per call, preferred over this table when present).
 */

export type ModelInfo = {
  id: string
  label: string
  /** USD per 1M input tokens. */
  inputPerM: number
  /** USD per 1M output tokens (reasoning/thinking tokens bill as output). */
  outputPerM: number
  /** Anthropic: accepts `output_config.effort` (Claude 5 family). */
  effort?: boolean
  /** Anthropic: accepts the server-side refusal fallback (`fallbacks: "default"`). */
  fallbacks?: boolean
}

export type ProviderInfo = {
  label: string
  defaultModel: string
  models: ModelInfo[]
  /** Where the user creates a key. */
  keyUrl: string
  /** Shown under the key field. */
  keyHint: string
}

export const AI_PROVIDERS: Record<AiProvider, ProviderInfo> = {
  xai: {
    label: "xAI (Grok)",
    defaultModel: "grok-4.7",
    models: [
      { id: "grok-4.7", label: "Grok 4.7", inputPerM: 2, outputPerM: 6 },
      { id: "grok-4.3", label: "Grok 4.3", inputPerM: 1.25, outputPerM: 2.5 },
      { id: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 (non-reasoning)", inputPerM: 1.25, outputPerM: 2.5 },
    ],
    keyUrl: "https://console.x.ai",
    keyHint: "A Grok subscription doesn't include API credits: add credits in the xAI console.",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-6.1-sol",
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerM: 2, outputPerM: 10 },
      { id: "gpt-6-astra", label: "GPT-6 Astra", inputPerM: 10, outputPerM: 50 },
      { id: "gpt-6-luna", label: "GPT-6 Luna", inputPerM: 0.1, outputPerM: 0.5 },
      { id: "gpt-5.5", label: "GPT-5.5", inputPerM: 5, outputPerM: 30 },
    ],
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "Billed per token by OpenAI; a ChatGPT plan doesn't include API credits.",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    defaultModel: "claude-opus-5-5",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerM: 4, outputPerM: 20, effort: true, fallbacks: true },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerM: 2, outputPerM: 10, effort: true, fallbacks: true },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", inputPerM: 0.1, outputPerM: 0.5, effort: true },
      { id: "claude-fable-5-1", label: "Claude Fable 5.1", inputPerM: 10, outputPerM: 50, effort: true, fallbacks: true },
    ],
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "Billed per token by Anthropic; a Claude plan doesn't include API credits.",
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "anthropic/claude-opus-5.5",
    models: [
      { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", inputPerM: 4, outputPerM: 20 },
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", inputPerM: 2, outputPerM: 10 },
      { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerM: 2, outputPerM: 10 },
      { id: "x-ai/grok-4.7", label: "Grok 4.7", inputPerM: 2, outputPerM: 6 },
    ],
    keyUrl: "https://openrouter.ai/settings/keys",
    keyHint: "One key for many models. OpenRouter reports the exact cost of each call.",
  },
}

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProvider[]

export function findModel(provider: AiProvider, model: string): ModelInfo | undefined {
  return AI_PROVIDERS[provider]?.models.find((m) => m.id === model)
}

/** Estimated USD for a call, or null when the model isn't in the table. */
export function estimateCostUsd(
  provider: AiProvider,
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const info = findModel(provider, model)
  if (!info) return null
  return (inputTokens * info.inputPerM + outputTokens * info.outputPerM) / 1_000_000
}

/** Rough token count for estimates before a call (about 4 characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

/** "$0.0042", "<$0.0001", "$1.20". */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.0001) return "<$0.0001"
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** "$2.00 in / $6.00 out per 1M tokens". */
export const formatModelPrice = (m: ModelInfo) =>
  `$${m.inputPerM.toFixed(2)} in / $${m.outputPerM.toFixed(2)} out per 1M tokens`
