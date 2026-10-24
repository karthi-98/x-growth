// Owner: ai workstream (docs/WORKSTREAMS.md). Replace the stub bodies.

/*
 * One interface over the user's chosen AI provider (lib/secrets.ts AiKey).
 * Every call is logged to ai_generations and lib/spend.ts. AI output is
 * always a draft; nothing here posts.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string }

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
}

export async function generateText(_input: GenerateInput): Promise<GenerateOutput> {
  throw new Error("generateText is not implemented yet (owner: ai workstream)")
}

/** Tiny test prompt with the saved key. */
export async function verifyAiKey(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  return { ok: false, error: "verifyAiKey is not implemented yet (owner: ai workstream)" }
}
