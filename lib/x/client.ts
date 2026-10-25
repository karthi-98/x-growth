/*
 * X API writes with the user's own OAuth 1.0a keys (lib/secrets.ts). Every
 * paid call records its cost with lib/spend.ts. Other workstreams never call X
 * directly: replies and posts go through the drafts queue (status
 * "scheduled", scheduled_at = now) and the publish job sends them.
 *
 * XGROWTH_X_DRY_RUN=1 makes no network call: createPost returns fake ids and
 * verifyXKeys only checks that keys are saved. Use it for development and tests.
 */
import { readSecrets, type XKeys } from "../secrets"
import { recordSpend, X_PRICES_USD } from "../spend"

import { PERMISSIONS_HELP, XApiError, xErrorFromNetwork, xErrorFromResponse } from "./errors"
import { oauthHeader } from "./oauth"
import { containsUrl } from "./text"

export { XApiError } from "./errors"

const API = "https://api.x.com/2"
const TIMEOUT_MS = 30_000

export type CreatePostInput = {
  text: string
  /** Post id this replies to (thread parts and replies). */
  replyToId?: string
  /** Post id this quotes. */
  quoteId?: string
}

export type CreatePostResult = { id: string; text: string }

/** Test hooks; production calls pass nothing. */
export type XClientOptions = { keys?: XKeys; fetch?: typeof fetch }

export const isXDryRun = () => process.env.XGROWTH_X_DRY_RUN === "1"

export const DRY_RUN_ID_PREFIX = "dry-run-"
export const isDryRunId = (id: string) => id.startsWith(DRY_RUN_ID_PREFIX)

let dryRunCounter = 0

function savedKeys(): XKeys {
  const x = readSecrets().x
  if (!x?.apiKey || !x.apiSecret || !x.accessToken || !x.accessTokenSecret) {
    throw new XApiError("no-keys", "No X API keys saved. Add them in Settings → X API keys.")
  }
  return x
}

/** Record spend without ever failing the call that already happened. */
async function record(operation: string, estCostUsd: number) {
  try {
    await recordSpend({ provider: "x", operation, estCostUsd })
  } catch (err) {
    console.error(`[x] could not record spend for ${operation}: ${err instanceof Error ? err.message : err}`)
  }
}

async function xRequest(
  method: "GET" | "POST",
  url: string,
  keys: XKeys,
  body: unknown,
  doFetch: typeof fetch,
  context?: { reply?: boolean; quote?: boolean }
): Promise<{ json: unknown; headers: Headers }> {
  let res: Response
  try {
    res = await doFetch(url, {
      method,
      headers: {
        Authorization: oauthHeader({ method, url, keys }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw xErrorFromNetwork(err)
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) throw xErrorFromResponse(res.status, res.headers, json, context)
  return { json, headers: res.headers }
}

/** POST /2/tweets. Costs $0.015, or $0.20 when the text contains a URL. */
export async function createPost(input: CreatePostInput, opts: XClientOptions = {}): Promise<CreatePostResult> {
  if (isXDryRun()) {
    return { id: `${DRY_RUN_ID_PREFIX}${Date.now()}-${++dryRunCounter}`, text: input.text }
  }
  const keys = opts.keys ?? savedKeys()
  const body: Record<string, unknown> = { text: input.text }
  if (input.replyToId) body.reply = { in_reply_to_tweet_id: input.replyToId }
  if (input.quoteId) body.quote_tweet_id = input.quoteId

  const { json } = (await xRequest("POST", `${API}/tweets`, keys, body, opts.fetch ?? fetch, {
    reply: !!input.replyToId,
    quote: !!input.quoteId,
  })) as { json: { data?: { id?: string; text?: string } } | null }
  const id = json?.data?.id
  if (!id) {
    // 2xx without an id: X may still have posted, so the publisher must check.
    throw new XApiError("server", "X answered without a post id.", 200)
  }
  const withUrl = containsUrl(input.text)
  await record(
    withUrl ? "post.create.url" : "post.create",
    withUrl ? X_PRICES_USD.postCreateWithUrl : X_PRICES_USD.postCreate
  )
  return { id, text: json?.data?.text ?? input.text }
}

/** GET /2/users/me with the saved keys: checks them without posting (about $0.01). */
export async function verifyXKeys(
  opts: XClientOptions = {}
): Promise<{ ok: true; id: string; username: string; dryRun?: boolean } | { ok: false; error: string }> {
  try {
    const keys = opts.keys ?? savedKeys()
    if (isXDryRun()) return { ok: true, id: "0", username: "dry-run", dryRun: true }
    const { json, headers } = (await xRequest("GET", `${API}/users/me`, keys, undefined, opts.fetch ?? fetch)) as {
      json: { data?: { id?: string; username?: string } } | null
      headers: Headers
    }
    await record("users.me", X_PRICES_USD.userRead)
    if (!json?.data?.id || !json.data.username) return { ok: false, error: "X answered without a user." }
    // OAuth 1.0a responses say what the token may do; a read-only token can verify but never post.
    if (headers.get("x-access-level") === "read") return { ok: false, error: PERMISSIONS_HELP }
    return { ok: true, id: json.data.id, username: json.data.username }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
