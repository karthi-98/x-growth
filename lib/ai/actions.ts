"use server"

import { refresh } from "next/cache"

import { aiProviders, readSecrets, writeSecrets, type AiProvider } from "@/lib/secrets"
import { buildVoiceProfile, getVoiceProfile, readVoiceProfile } from "@/lib/voice/profile"

import { aiKeyStatus, generateText, markGenerationAccepted, verifyAiKey, type AiKeyStatus } from "./index"
import { isAiError, type AiErrorCode } from "./errors"
import { AI_PROVIDERS, estimateCostUsd, estimateTokens } from "./models"
import { assistModes, assistPrompt, needsDraft, parseSuggestions, systemPrompt, type AssistMode } from "./prompts"

/*
 * Server actions for AI assist (compose), the AI key form and the voice
 * profile. They run on this computer only; keys never go back to the
 * browser (AiKeyStatus is masked). Inputs are checked here because any
 * local page could call them.
 */

export type ActionError = { ok: false; error: string; code?: AiErrorCode }

const MAX_DRAFT_CHARS = 4000
/** Output budget used for the per-click estimate (three short posts plus some reasoning). */
const EST_OUTPUT_TOKENS = 600

function toActionError(err: unknown, fallback: string): ActionError {
  if (isAiError(err)) return { ok: false, error: err.message, code: err.code }
  console.error("[ai]", err instanceof Error ? err.message : err)
  return { ok: false, error: fallback }
}

export type AiAssistStatus = AiKeyStatus & {
  /** Rough cost of one click with the saved model, null when the model's price is unknown. */
  estCostUsd: number | null
}

export async function getAiAssistStatus(): Promise<AiAssistStatus> {
  const status = aiKeyStatus()
  if (!status.hasKey || !status.provider || !status.model) return { ...status, estCostUsd: null }
  const voice = readVoiceProfile()
  const inputTokens = estimateTokens(systemPrompt(voice)) + 250
  return { ...status, estCostUsd: estimateCostUsd(status.provider, status.model, inputTokens, EST_OUTPUT_TOKENS) }
}

export type AssistResult =
  | { ok: true; suggestions: string[]; generationId: string; estCostUsd: number; model: string }
  | ActionError

export async function runAiAssist(input: { mode: AssistMode; text: string }): Promise<AssistResult> {
  const mode = input?.mode
  if (!assistModes.includes(mode)) return { ok: false, error: "Unknown AI action." }
  const text = typeof input.text === "string" ? input.text.slice(0, MAX_DRAFT_CHARS) : ""
  if (needsDraft(mode) && !text.trim()) return { ok: false, error: "Write something first, then ask AI to rework it." }

  try {
    const voice = await getVoiceProfile()
    const prompt = assistPrompt(mode, text, voice)
    const out = await generateText({ kind: mode === "ideas" ? "idea" : "rewrite", ...prompt })
    const suggestions = parseSuggestions(out.text)
    if (!suggestions.length) {
      return { ok: false, error: "The model didn't return any usable suggestions. Try again.", code: "provider" }
    }
    return { ok: true, suggestions, generationId: out.generationId, estCostUsd: out.estCostUsd, model: out.model }
  } catch (err) {
    return toActionError(err, "AI assist failed. Try again.")
  }
}

/** The user applied (or sent) an AI output. */
export async function markAiAccepted(generationId: string): Promise<void> {
  if (typeof generationId !== "string" || !/^[0-9a-f-]{36}$/i.test(generationId)) return
  await markGenerationAccepted(generationId)
}

// ------------------------------------------------------------- key form

export async function getAiKeyState(): Promise<AiKeyStatus> {
  return aiKeyStatus()
}

export type SaveAiKeyResult =
  | { ok: true; status: AiKeyStatus; verify: Awaited<ReturnType<typeof verifyAiKey>> }
  | ActionError

const MODEL_RE = /^[\w.:/@[\]-]{1,120}$/

/**
 * Takes FormData (provider, apiKey, model), not an object: `next dev` logs
 * server action arguments, and FormData prints as {} so the key stays out
 * of the terminal.
 */
export async function saveAiKey(form: FormData): Promise<SaveAiKeyResult> {
  if (!(form instanceof FormData)) return { ok: false, error: "Pick a provider." }
  const field = (name: string) => {
    const v = form.get(name)
    return typeof v === "string" ? v.trim() : ""
  }
  const provider = field("provider") as AiProvider
  if (!aiProviders.includes(provider)) return { ok: false, error: "Pick a provider." }
  const model = field("model") || AI_PROVIDERS[provider].defaultModel
  if (!MODEL_RE.test(model)) return { ok: false, error: "That model id doesn't look right." }

  const pasted = field("apiKey")
  const current = readSecrets().ai
  let apiKey = pasted
  if (!apiKey) {
    // Keep the saved key when only the model changed.
    if (current?.apiKey && current.provider === provider) apiKey = current.apiKey
    else return { ok: false, error: `Paste your ${AI_PROVIDERS[provider].label} API key.` }
  } else if (/\s/.test(apiKey) || apiKey.length < 10 || apiKey.length > 400) {
    return { ok: false, error: "That doesn't look like an API key. Copy it again without spaces." }
  }

  writeSecrets({ ai: { provider, apiKey, model } })
  const verify = await verifyAiKey()
  refresh()
  return { ok: true, status: aiKeyStatus(), verify }
}

export async function verifySavedAiKey(): Promise<Awaited<ReturnType<typeof verifyAiKey>>> {
  const result = await verifyAiKey()
  refresh()
  return result
}

export async function removeAiKey(): Promise<AiKeyStatus> {
  writeSecrets({ ai: undefined })
  refresh()
  return aiKeyStatus()
}

// -------------------------------------------------------- voice profile

/** Form action for the Settings "Rebuild voice profile" button. */
export async function rebuildVoiceProfile(): Promise<void> {
  await buildVoiceProfile()
  refresh()
}
