import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { aiGenerations } from "@/lib/db/schema"
import { hasAiKey, maskSecret, readSecrets, type AiProvider } from "@/lib/secrets"
import { recordSpend } from "@/lib/spend"

import { callProvider, type ChatMessage, type FetchLike } from "./adapters"
import { monthSpend, overCap } from "./budget"
import { AiError, isAiError } from "./errors"
import { AI_PROVIDERS, estimateCostUsd, formatUsd } from "./models"

/*
 * One interface over the user's chosen AI provider (lib/secrets.ts AiKey).
 * Every call is logged to ai_generations and lib/spend.ts. AI output is
 * always a draft; nothing here posts.
 */

export type { ChatMessage }

export type GenerateInput = {
  /** ai_generations.kind: reply | rewrite | idea | thread | voice-profile | test */
  kind: string
  system: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export type GenerateOutput = {
  text: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estCostUsd: number
  /** ai_generations.id, for marking the output accepted later. */
  generationId: string
  /** Output stopped at the token cap. */
  truncated?: boolean
}

export type GenerateOptions = {
  /** Injected in tests; defaults to global fetch. */
  fetch?: FetchLike
  now?: Date
}

/** Room for reasoning/thinking tokens on top of a short post. */
const DEFAULT_MAX_TOKENS = 4096

export async function generateText(input: GenerateInput, opts: GenerateOptions = {}): Promise<GenerateOutput> {
  const secrets = readSecrets()
  if (!secrets.ai || !hasAiKey(secrets)) {
    throw new AiError("no-key", "Add your AI key in Settings → AI to use AI writing.")
  }
  if (!(secrets.ai.provider in AI_PROVIDERS)) {
    throw new AiError("no-key", "The saved AI provider isn't supported. Pick one again in Settings → AI.")
  }
  const key = { ...secrets.ai, model: secrets.ai.model?.trim() || AI_PROVIDERS[secrets.ai.provider].defaultModel }

  const spend = await monthSpend(opts.now)
  if (overCap(spend)) {
    throw new AiError(
      "spend-cap",
      `This month's spend reached your cap of ${formatUsd(spend.capUsd ?? 0)}. Raise it in Settings to keep using AI.`
    )
  }

  const result = await callProvider(
    key,
    {
      system: input.system,
      messages: input.messages,
      maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: input.temperature,
    },
    opts.fetch
  )

  // Prefer the provider's own figure; otherwise price the served model, then the requested one.
  const estCostUsd =
    result.reportedCostUsd ??
    estimateCostUsd(key.provider, result.model, result.inputTokens, result.outputTokens) ??
    estimateCostUsd(key.provider, key.model, result.inputTokens, result.outputTokens) ??
    0

  const generationId = randomUUID()
  await db.insert(aiGenerations).values({
    id: generationId,
    kind: input.kind,
    provider: key.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estCostUsd,
    output: result.text,
    accepted: null,
    createdAt: (opts.now ?? new Date()).toISOString(),
  })
  await recordSpend({ provider: "ai", operation: `ai.${input.kind}`, units: 1, estCostUsd })

  return {
    text: result.text,
    provider: key.provider,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estCostUsd,
    generationId,
    truncated: result.truncated,
  }
}

/** Tiny test prompt with the saved key. */
export async function verifyAiKey(
  opts: GenerateOptions = {}
): Promise<{ ok: true; model: string; estCostUsd?: number } | { ok: false; error: string; code?: string }> {
  try {
    const out = await generateText(
      {
        kind: "test",
        system: "You are a connection test. Reply with the single word OK.",
        messages: [{ role: "user", content: "Reply with OK." }],
        // Generous so reasoning models still finish; a reply this short costs a fraction of a cent.
        maxTokens: 1024,
      },
      opts
    )
    return { ok: true, model: out.model, estCostUsd: out.estCostUsd }
  } catch (err) {
    if (isAiError(err)) return { ok: false, error: err.message, code: err.code }
    console.error("[ai] verify failed:", err instanceof Error ? err.message : err)
    return { ok: false, error: "Couldn't verify the key. Try again." }
  }
}

/** Record whether the user used an AI output (applied a suggestion, sent a reply). */
export async function markGenerationAccepted(generationId: string, accepted = true): Promise<void> {
  await db.update(aiGenerations).set({ accepted }).where(eq(aiGenerations.id, generationId))
}

export type AiKeyStatus = {
  hasKey: boolean
  provider: AiProvider | null
  providerLabel: string | null
  model: string | null
  /** "••••••a1B2"; never the key. */
  maskedKey: string
}

/** What the UI may know about the saved key. */
export function aiKeyStatus(): AiKeyStatus {
  const s = readSecrets()
  const ai = s.ai
  if (!ai) return { hasKey: false, provider: null, providerLabel: null, model: null, maskedKey: "" }
  return {
    hasKey: hasAiKey(s),
    provider: ai.provider,
    providerLabel: AI_PROVIDERS[ai.provider]?.label ?? ai.provider,
    model: ai.model || AI_PROVIDERS[ai.provider]?.defaultModel || null,
    maskedKey: maskSecret(ai.apiKey),
  }
}
