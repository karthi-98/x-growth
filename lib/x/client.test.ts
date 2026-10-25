import { afterEach, beforeAll, describe, expect, test } from "bun:test"

import { useTempDatabase } from "../publish/testing"

// Dynamic imports: lib/db/client must load after the temp database is set.
let client: typeof import("./client")
let db: Awaited<ReturnType<typeof useTempDatabase>>
let schema: typeof import("../db/schema")

beforeAll(async () => {
  db = await useTempDatabase()
  client = await import("./client")
  schema = await import("../db/schema")
})

afterEach(async () => {
  delete process.env.XGROWTH_X_DRY_RUN
  await db.delete(schema.spendLedger)
})

const keys = { apiKey: "ck", apiSecret: "cs", accessToken: "42-token", accessTokenSecret: "ts" }

type Call = { url: string; init: RequestInit }
function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
  }) as typeof fetch
  return { fn, calls }
}

describe("createPost", () => {
  test("sends text, reply and quote ids with an OAuth header, and records $0.015", async () => {
    const f = fakeFetch(201, { data: { id: "111", text: "hi", edit_history_post_ids: ["111"] } })
    const res = await client.createPost({ text: "hi", replyToId: "9", quoteId: "8" }, { keys, fetch: f.fn })
    expect(res).toEqual({ id: "111", text: "hi" })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe("https://api.x.com/2/tweets")
    expect(f.calls[0].init.method).toBe("POST")
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      text: "hi",
      reply: { in_reply_to_tweet_id: "9" },
      quote_tweet_id: "8",
    })
    const headers = f.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^OAuth oauth_consumer_key="ck", .*oauth_signature="[^"]+".*oauth_token="42-token"/)
    const spend = await db.select().from(schema.spendLedger)
    expect(spend.map((s) => [s.operation, s.estCostUsd])).toEqual([["post.create", 0.015]])
  })

  test("records $0.20 when the text has a link", async () => {
    const f = fakeFetch(201, { data: { id: "112", text: "x" } })
    await client.createPost({ text: "read example.com" }, { keys, fetch: f.fn })
    const spend = await db.select().from(schema.spendLedger)
    expect(spend.map((s) => [s.operation, s.estCostUsd])).toEqual([["post.create.url", 0.2]])
  })

  test("403 oauth1-permissions explains Read and Write", async () => {
    const f = fakeFetch(403, {
      title: "Forbidden",
      detail: "Your client app is not configured with the appropriate oauth1 app permissions for this endpoint.",
      type: "https://api.twitter.com/2/problems/oauth1-permissions",
      status: 403,
    })
    const err = await client.createPost({ text: "hi" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err).toBeInstanceOf(client.XApiError)
    expect(err.kind).toBe("permissions")
    expect(err.message).toContain("must be Read and Write before generating the access token")
    expect(await db.select().from(schema.spendLedger)).toHaveLength(0)
  })

  test("401 says the keys were rejected", async () => {
    const f = fakeFetch(401, { title: "Unauthorized", status: 401, detail: "Unauthorized", type: "about:blank" })
    const err = await client.createPost({ text: "hi" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err.kind).toBe("auth")
    expect(err.message).toContain("401")
  })

  test("403 on a reply mentions the pay-per-use reply rule", async () => {
    const f = fakeFetch(403, { detail: "Reply to this conversation is not allowed", status: 403 })
    const err = await client.createPost({ text: "hi", replyToId: "5" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err.kind).toBe("forbidden")
    expect(err.message).toContain("mentioned or quoted you")
  })

  test("403 duplicate content", async () => {
    const f = fakeFetch(403, { detail: "You are not allowed to create a Tweet with duplicate content.", status: 403 })
    const err = await client.createPost({ text: "hi" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err.kind).toBe("duplicate")
  })

  test("429 reads the reset header", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const f = fakeFetch(
      429,
      { errors: [{ code: 88, message: "Rate limit exceeded" }] },
      { "x-rate-limit-reset": String(reset), "x-rate-limit-remaining": "0" }
    )
    const err = await client.createPost({ text: "hi" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err.kind).toBe("rate-limit")
    expect(err.retryAt.getTime()).toBe(reset * 1000)
  })

  test("429 prefers an exhausted 24-hour window, then retry-after", async () => {
    const now = Math.floor(Date.now() / 1000)
    const f = fakeFetch(
      429,
      {},
      {
        "x-rate-limit-reset": String(now + 60),
        "x-user-limit-24hour-remaining": "0",
        "x-user-limit-24hour-reset": String(now + 7200),
      }
    )
    const err = await client.createPost({ text: "hi" }, { keys, fetch: f.fn }).catch((e) => e)
    expect(err.retryAt.getTime()).toBe((now + 7200) * 1000)

    const g = fakeFetch(429, {}, { "retry-after": "120" })
    const err2 = await client.createPost({ text: "hi" }, { keys, fetch: g.fn }).catch((e) => e)
    expect(Math.abs(err2.retryAt.getTime() - (Date.now() + 120_000))).toBeLessThan(2000)
  })

  test("network errors say whether X could have received the post", async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })
    }) as unknown as typeof fetch
    const timeout = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    }) as unknown as typeof fetch
    const a = await client.createPost({ text: "hi" }, { keys, fetch: refused }).catch((e) => e)
    const b = await client.createPost({ text: "hi" }, { keys, fetch: timeout }).catch((e) => e)
    expect([a.kind, a.maybeSent]).toEqual(["network", false])
    expect([b.kind, b.maybeSent]).toEqual(["network", true])
  })

  test("dry run returns fake ids and makes no request", async () => {
    process.env.XGROWTH_X_DRY_RUN = "1"
    const f = fakeFetch(500, {})
    const a = await client.createPost({ text: "one" }, { fetch: f.fn })
    const b = await client.createPost({ text: "two" }, { fetch: f.fn })
    expect(f.calls).toHaveLength(0)
    expect(client.isDryRunId(a.id)).toBe(true)
    expect(a.id).not.toBe(b.id)
    expect(await db.select().from(schema.spendLedger)).toHaveLength(0)
  })
})

describe("verifyXKeys", () => {
  test("GET /2/users/me returns the username and records the read", async () => {
    const f = fakeFetch(200, { data: { id: "42", name: "K", username: "designwkarthick" } }, { "x-access-level": "read-write" })
    const res = await client.verifyXKeys({ keys, fetch: f.fn })
    expect(res).toEqual({ ok: true, id: "42", username: "designwkarthick" })
    expect(f.calls[0].url).toBe("https://api.x.com/2/users/me")
    expect(f.calls[0].init.method).toBe("GET")
    const spend = await db.select().from(schema.spendLedger)
    expect(spend.map((s) => s.operation)).toEqual(["users.me"])
  })

  test("a read-only token fails with the permissions help", async () => {
    const f = fakeFetch(200, { data: { id: "42", username: "u" } }, { "x-access-level": "read" })
    const res = await client.verifyXKeys({ keys, fetch: f.fn })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain("Read and Write")
  })

  test("errors come back as messages", async () => {
    const f = fakeFetch(401, {})
    const res = await client.verifyXKeys({ keys, fetch: f.fn })
    expect(res.ok).toBe(false)
  })
})
