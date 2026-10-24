import { beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { blockNetwork, mockFetch, useTestDataDir } from "./testing/env"

// Everything that opens the DB is imported after the temp data dir is set up.
let ai: typeof import("./index")
let schema: typeof import("@/lib/db/schema")
let db: (typeof import("@/lib/db/client"))["db"]
let secrets: typeof import("@/lib/secrets")
let settings: typeof import("@/lib/settings")

beforeAll(async () => {
  blockNetwork()
  await useTestDataDir()
  ai = await import("./index")
  schema = await import("@/lib/db/schema")
  db = (await import("@/lib/db/client")).db
  secrets = await import("@/lib/secrets")
  settings = await import("@/lib/settings")
})

beforeEach(async () => {
  await db.delete(schema.aiGenerations)
  await db.delete(schema.spendLedger)
  await settings.resetSetting("monthlySpendCapUsd")
  secrets.writeSecrets({ ai: { provider: "anthropic", apiKey: "test-anthropic-key-123456", model: "claude-opus-5-5" } })
})

const anthropicOk = (text = "Draft reply", usage = { input_tokens: 1000, output_tokens: 500 }) =>
  mockFetch(() => ({ json: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text }], usage } }))

describe("generateText", () => {
  test("logs the generation and its cost, and records spend", async () => {
    const m = anthropicOk()
    const out = await ai.generateText(
      { kind: "reply", system: "sys", messages: [{ role: "user", content: "hi" }] },
      { fetch: m.fetch }
    )
    // claude-opus-5-5 at $4 / $20 per 1M: 1000 in + 500 out = $0.014
    expect(out.estCostUsd).toBeCloseTo(0.014, 10)
    expect(out).toMatchObject({ text: "Draft reply", provider: "anthropic", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 500 })

    const gens = await db.select().from(schema.aiGenerations)
    expect(gens).toHaveLength(1)
    expect(gens[0]).toMatchObject({
      id: out.generationId,
      kind: "reply",
      provider: "anthropic",
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 500,
      output: "Draft reply",
      accepted: null,
    })
    expect(gens[0].estCostUsd).toBeCloseTo(0.014, 10)

    const ledger = await db.select().from(schema.spendLedger)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ provider: "ai", operation: "ai.reply", units: 1 })
    expect(ledger[0].estCostUsd).toBeCloseTo(0.014, 10)

    await ai.markGenerationAccepted(out.generationId)
    const [after] = await db.select().from(schema.aiGenerations)
    expect(after.accepted).toBe(true)
  })

  test("uses the provider's reported cost when there is one", async () => {
    secrets.writeSecrets({ ai: { provider: "openrouter", apiKey: "test-openrouter-key-123456", model: "x-ai/grok-4.7" } })
    const m = mockFetch(() => ({
      json: { model: "x-ai/grok-4.7", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0123 } },
    }))
    const out = await ai.generateText({ kind: "rewrite", system: "s", messages: [{ role: "user", content: "x" }] }, { fetch: m.fetch })
    expect(out.estCostUsd).toBe(0.0123)
    const [row] = await db.select().from(schema.spendLedger)
    expect(row).toMatchObject({ operation: "ai.rewrite", estCostUsd: 0.0123 })
  })

  test("no key: a clear error and no request", async () => {
    secrets.writeSecrets({ ai: undefined })
    const m = anthropicOk()
    const err = await ai.generateText({ kind: "idea", system: "s", messages: [] }, { fetch: m.fetch }).catch((e) => e)
    expect(err.code).toBe("no-key")
    expect(m.calls).toHaveLength(0)
    expect(ai.aiKeyStatus()).toMatchObject({ hasKey: false, maskedKey: "" })
  })

  test("a reached monthly spend cap blocks the call", async () => {
    await settings.updateSettings({ monthlySpendCapUsd: 0.01 })
    await db.insert(schema.spendLedger).values({ provider: "x", operation: "post.create", units: 1, estCostUsd: 0.015, at: new Date().toISOString() })
    const m = anthropicOk()
    const err = await ai.generateText({ kind: "idea", system: "s", messages: [] }, { fetch: m.fetch }).catch((e) => e)
    expect(err.code).toBe("spend-cap")
    expect(m.calls).toHaveLength(0)
  })

  test("provider errors aren't logged as spend", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: { type: "authentication_error", message: "invalid x-api-key" } } }))
    const err = await ai.generateText({ kind: "idea", system: "s", messages: [] }, { fetch: m.fetch }).catch((e) => e)
    expect(err.code).toBe("bad-key")
    expect(await db.select().from(schema.spendLedger)).toHaveLength(0)
  })
})

describe("verifyAiKey and key status", () => {
  test("ok with a tiny test prompt, logged as kind test", async () => {
    const m = anthropicOk("OK", { input_tokens: 20, output_tokens: 2 })
    const res = await ai.verifyAiKey({ fetch: m.fetch })
    expect(res).toMatchObject({ ok: true, model: "claude-opus-5-5" })
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0].body.messages).toEqual([{ role: "user", content: "Reply with OK." }])
    const [gen] = await db.select().from(schema.aiGenerations)
    expect(gen.kind).toBe("test")
  })

  test("failure returns a friendly message", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: { message: "bad" } } }))
    const res = await ai.verifyAiKey({ fetch: m.fetch })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("rejected the API key")
  })

  test("status is masked", () => {
    const s = ai.aiKeyStatus()
    expect(s).toEqual({
      hasKey: true,
      provider: "anthropic",
      providerLabel: "Anthropic (Claude)",
      model: "claude-opus-5-5",
      maskedKey: "••••••3456",
    })
    expect(JSON.stringify(s)).not.toContain("test-anthropic-key")
  })
})
