import { beforeAll, describe, expect, test } from "bun:test"

import type { AiKey } from "@/lib/secrets"

import { ANTHROPIC_FALLBACK_BETA, ANTHROPIC_VERSION, callProvider, type ProviderRequest } from "./adapters"
import { AiError } from "./errors"
import { blockNetwork, mockFetch } from "./testing/env"

beforeAll(blockNetwork)

const req: ProviderRequest = {
  system: "SYSTEM PROMPT",
  messages: [{ role: "user", content: "Rewrite this" }],
  maxTokens: 500,
  temperature: 0.7,
}

const key = (provider: AiKey["provider"], model: string): AiKey => ({ provider, model, apiKey: `test-${provider}-key-123456` })

/** The AiError a call rejects with (fails the test if it resolves). */
const rejection = (p: Promise<unknown>): Promise<AiError> =>
  p.then(
    () => {
      throw new Error("expected the call to fail")
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(AiError)
      return e as AiError
    }
  )

describe("xAI (Responses API)", () => {
  test("request shape and parsing", async () => {
    const m = mockFetch(() => ({
      json: {
        model: "grok-4.7",
        status: "completed",
        output: [
          { type: "reasoning", summary: [] },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello there" }] },
        ],
        usage: { input_tokens: 120, output_tokens: 30, cost_in_nano_usd: 420_000 },
      },
    }))
    const out = await callProvider(key("xai", "grok-4.7"), req, m.fetch)

    expect(m.calls).toHaveLength(1)
    const [call] = m.calls
    expect(call.url).toBe("https://api.x.ai/v1/responses")
    expect(call.init.method).toBe("POST")
    expect(call.headers.authorization).toBe("Bearer test-xai-key-123456")
    expect(call.body).toEqual({
      model: "grok-4.7",
      instructions: "SYSTEM PROMPT",
      input: [{ role: "user", content: "Rewrite this" }],
      max_output_tokens: 500,
      store: false,
      temperature: 0.7,
    })
    expect(out).toEqual({
      text: "Hello there",
      model: "grok-4.7",
      inputTokens: 120,
      outputTokens: 30,
      reportedCostUsd: 0.00042,
      truncated: false,
    })
  })
})

describe("OpenAI (Responses API)", () => {
  test("request shape: no sampling params, store off", async () => {
    const m = mockFetch(() => ({
      json: {
        model: "gpt-6.1-sol",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "message", content: [{ type: "output_text", text: "Partial" }] }],
        usage: { input_tokens: 50, output_tokens: 500 },
      },
    }))
    const out = await callProvider(key("openai", "gpt-6.1-sol"), req, m.fetch)
    const [call] = m.calls
    expect(call.url).toBe("https://api.openai.com/v1/responses")
    expect(call.headers.authorization).toBe("Bearer test-openai-key-123456")
    expect(call.body).toEqual({
      model: "gpt-6.1-sol",
      instructions: "SYSTEM PROMPT",
      input: [{ role: "user", content: "Rewrite this" }],
      max_output_tokens: 500,
      store: false,
    })
    expect(out.text).toBe("Partial")
    expect(out.truncated).toBe(true)
    expect(out.reportedCostUsd).toBeNull()
  })

  test("a refusal with no text is an AiError", async () => {
    const m = mockFetch(() => ({
      json: { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }], usage: {} },
    }))
    const err = await rejection(callProvider(key("openai", "gpt-6.1-sol"), req, m.fetch))
    expect(err).toBeInstanceOf(AiError)
    expect(err.code).toBe("refused")
  })
})

describe("Anthropic (Messages API)", () => {
  test("request shape for a Claude 5 model: version header, effort, fallbacks, no temperature", async () => {
    const m = mockFetch(() => ({
      json: {
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Hi " },
          { type: "text", text: "friend" },
        ],
        usage: { input_tokens: 200, cache_read_input_tokens: 10, output_tokens: 40 },
      },
    }))
    const out = await callProvider(key("anthropic", "claude-opus-5-5"), req, m.fetch)
    const [call] = m.calls
    expect(call.url).toBe("https://api.anthropic.com/v1/messages")
    expect(call.headers["x-api-key"]).toBe("test-anthropic-key-123456")
    expect(call.headers["anthropic-version"]).toBe(ANTHROPIC_VERSION)
    expect(call.headers["anthropic-beta"]).toBe(ANTHROPIC_FALLBACK_BETA)
    expect(call.headers.authorization).toBeUndefined()
    expect(call.body).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 500,
      system: "SYSTEM PROMPT",
      messages: [{ role: "user", content: "Rewrite this" }],
      output_config: { effort: "low" },
      fallbacks: "default",
    })
    expect("temperature" in call.body).toBe(false)
    expect(out).toMatchObject({ text: "Hi friend", inputTokens: 210, outputTokens: 40, truncated: false })
  })

  test("a custom model gets no beta header or model-specific params", async () => {
    const m = mockFetch(() => ({ json: { content: [{ type: "text", text: "ok" }], usage: {} } }))
    await callProvider(key("anthropic", "claude-something-new"), req, m.fetch)
    const [call] = m.calls
    expect(call.headers["anthropic-beta"]).toBeUndefined()
    expect(call.body.output_config).toBeUndefined()
    expect(call.body.fallbacks).toBeUndefined()
  })

  test("refusal stop reason", async () => {
    const m = mockFetch(() => ({ json: { stop_reason: "refusal", content: [], usage: {} } }))
    const err = await rejection(callProvider(key("anthropic", "claude-opus-5-5"), req, m.fetch))
    expect(err.code).toBe("refused")
  })
})

describe("OpenRouter (Chat Completions)", () => {
  test("request shape and reported cost", async () => {
    const m = mockFetch(() => ({
      json: {
        model: "anthropic/claude-opus-5.5",
        choices: [{ message: { role: "assistant", content: "Routed" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 80, completion_tokens: 12, cost: 0.0011 },
      },
    }))
    const out = await callProvider(key("openrouter", "anthropic/claude-opus-5.5"), req, m.fetch)
    const [call] = m.calls
    expect(call.url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(call.headers.authorization).toBe("Bearer test-openrouter-key-123456")
    expect(call.headers["x-title"]).toBe("X Growth")
    expect(call.body).toEqual({
      model: "anthropic/claude-opus-5.5",
      messages: [
        { role: "system", content: "SYSTEM PROMPT" },
        { role: "user", content: "Rewrite this" },
      ],
      max_tokens: 500,
      temperature: 0.7,
    })
    expect(out).toMatchObject({ text: "Routed", inputTokens: 80, outputTokens: 12, reportedCostUsd: 0.0011 })
  })

  test("an error object with HTTP 200 is still an error", async () => {
    const m = mockFetch(() => ({ json: { error: { code: 402, message: "Insufficient credits" } } }))
    const err = await rejection(callProvider(key("openrouter", "x-ai/grok-4.7"), req, m.fetch))
    expect(err.code).toBe("no-credit")
  })
})

describe("errors", () => {
  const fail = (provider: AiKey["provider"], status: number, json: unknown, headers?: Record<string, string>) =>
    rejection(callProvider(key(provider, "m"), req, mockFetch(() => ({ status, json, headers })).fetch))

  test("bad key", async () => {
    expect((await fail("openai", 401, { error: { message: "Incorrect API key provided: sk-abc***" } })).code).toBe("bad-key")
    expect((await fail("anthropic", 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })).code).toBe("bad-key")
    // xAI reports a wrong key as a 400.
    expect((await fail("xai", 400, { code: "Client specified an invalid argument", error: "Incorrect API key provided: xa***Lx." })).code).toBe("bad-key")
  })

  test("rate limit vs no credit on 429", async () => {
    const limited = await fail(
      "openai",
      429,
      { error: { type: "rate_limit_error", code: "slow_down", message: "Rate limit reached. Visit the billing page to raise limits." } },
      { "retry-after": "12" }
    )
    expect(limited.code).toBe("rate-limit")
    expect(limited.message).toContain("12s")
    const quota = await fail("openai", 429, { error: { type: "insufficient_quota", code: "credit_balance_exhausted", message: "You exceeded your current quota" } })
    expect(quota.code).toBe("no-credit")
    expect((await fail("anthropic", 429, { error: { type: "rate_limit_error", message: "Number of requests exceeded" } })).code).toBe("rate-limit")
  })

  test("no credit", async () => {
    expect((await fail("anthropic", 400, { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } })).code).toBe("no-credit")
    expect((await fail("anthropic", 402, { error: { type: "billing_error", message: "Billing problem" } })).code).toBe("no-credit")
    expect((await fail("openrouter", 402, { error: { code: 402, message: "Insufficient credits" } })).code).toBe("no-credit")
    expect((await fail("xai", 403, { error: "Your team doesn't have any credits yet." })).code).toBe("no-credit")
  })

  test("unknown model", async () => {
    expect((await fail("anthropic", 404, { error: { type: "not_found_error", message: "model: claude-nope" } })).code).toBe("bad-model")
    expect((await fail("openai", 400, { error: { message: "The model `gpt-nope` does not exist" } })).code).toBe("bad-model")
  })

  test("messages never contain the key", async () => {
    const k = key("openai", "gpt-6.1-sol")
    const err = await rejection(
      callProvider(k, req, mockFetch(() => ({ status: 400, json: { error: { message: `Bad thing with ${k.apiKey}` } } })).fetch)
    )
    expect(err.message).not.toContain(k.apiKey)
  })

  test("network failure", async () => {
    const err = await rejection(
      callProvider(key("xai", "grok-4.7"), req, async () => {
        throw new TypeError("fetch failed")
      })
    )
    expect(err.code).toBe("network")
  })
})
