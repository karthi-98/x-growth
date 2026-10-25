/*
 * X API failures, turned into messages a user can act on. The publisher
 * decides from `kind` whether a draft is retried, failed or needs a check.
 */

export type XErrorKind =
  /** 401: keys wrong, revoked or mismatched. */
  | "auth"
  /** 403 oauth1-permissions: the access token was made while the app was Read-only. */
  | "permissions"
  /** 403 duplicate content. */
  | "duplicate"
  /** Any other 403 (reply or quote not allowed, account locked, …). */
  | "forbidden"
  /** 402: no credits on the developer account. */
  | "billing"
  /** 429: wait until `retryAt`. */
  | "rate-limit"
  /** 400 / 404 / other 4xx: the request itself was refused. */
  | "invalid"
  /** 5xx: X may or may not have created the post. */
  | "server"
  /** No keys saved. */
  | "no-keys"
  /** The request failed in transit; `maybeSent` says whether X could have received it. */
  | "network"

export class XApiError extends Error {
  readonly kind: XErrorKind
  readonly status: number
  /** For rate limits: when to try again. */
  readonly retryAt?: Date
  /** For network errors: false only when the connection was never made. */
  readonly maybeSent: boolean

  constructor(kind: XErrorKind, message: string, status = 0, retryAt?: Date, maybeSent = kind === "server") {
    super(message)
    this.name = "XApiError"
    this.kind = kind
    this.status = status
    this.retryAt = retryAt
    this.maybeSent = maybeSent
  }
}

/** Error codes (Node and Bun) meaning the request never reached X. */
const NOT_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ConnectionRefused",
  "FailedToOpenSocket",
  "UND_ERR_CONNECT_TIMEOUT",
])

/** Wrap a thrown fetch error. Timeouts and resets may have reached X. */
export function xErrorFromNetwork(err: unknown): XApiError {
  const e = err as { code?: string; name?: string; message?: string; cause?: { code?: string } }
  const code = e?.cause?.code ?? e?.code ?? ""
  const notSent = NOT_SENT_CODES.has(code) || /unable to connect|getaddrinfo/i.test(e?.message ?? "")
  const reason = e?.name === "TimeoutError" ? "timed out" : `failed (${code || e?.message || "network error"})`
  return new XApiError("network", `The request to X ${reason}.`, 0, undefined, !notSent)
}

export const PERMISSIONS_HELP =
  "Your X app's permissions must be Read and Write before generating the access token. " +
  "In the X developer portal, set User authentication settings → App permissions to Read and Write, " +
  "then regenerate the Access Token and Secret and paste the new pair here."

type ErrorBody = {
  title?: string
  detail?: string
  type?: string
  message?: string
  errors?: { message?: string; code?: number; title?: string; detail?: string; type?: string }[]
}

function describe(body: ErrorBody | null): { text: string; type: string } {
  if (!body) return { text: "", type: "" }
  const first = body.errors?.[0]
  const text = body.detail ?? body.message ?? first?.detail ?? first?.message ?? body.title ?? first?.title ?? ""
  return { text, type: `${body.type ?? ""} ${first?.type ?? ""}` }
}

/** Unix seconds or HTTP-date header → Date. */
function headerDate(headers: Headers, name: string): Date | undefined {
  const raw = headers.get(name)
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) {
    const n = Number(raw)
    // retry-after is seconds from now; the reset headers are epoch seconds.
    return new Date(name === "retry-after" ? Date.now() + n * 1000 : n * 1000)
  }
  const t = Date.parse(raw)
  return Number.isNaN(t) ? undefined : new Date(t)
}

/** When a 429 lifts: the exhausted 24-hour window if any, else the 15-minute one, else retry-after. */
export function rateLimitResetAt(headers: Headers, now = Date.now()): Date {
  const candidates: (Date | undefined)[] = []
  if (headers.get("x-user-limit-24hour-remaining") === "0") candidates.push(headerDate(headers, "x-user-limit-24hour-reset"))
  if (headers.get("x-app-limit-24hour-remaining") === "0") candidates.push(headerDate(headers, "x-app-limit-24hour-reset"))
  candidates.push(headerDate(headers, "x-rate-limit-reset"), headerDate(headers, "retry-after"))
  const times = candidates.filter((d): d is Date => !!d && d.getTime() > now).map((d) => d.getTime())
  return new Date(times.length ? Math.max(...times) : now + 15 * 60_000)
}

const timeLabel = (d: Date) => d.toISOString().slice(11, 16) + " UTC"

/** Build the error for a non-2xx X response. `context` tunes 403 hints. */
export function xErrorFromResponse(
  status: number,
  headers: Headers,
  body: ErrorBody | null,
  context: { reply?: boolean; quote?: boolean } = {}
): XApiError {
  const { text, type } = describe(body)
  const detail = text ? `: ${text}` : ""

  if (status === 401) {
    return new XApiError(
      "auth",
      "X rejected the keys (401). Check that all four keys are pasted correctly and come from the same app, " +
        "and that the access token wasn't regenerated or revoked since.",
      status
    )
  }
  if (status === 403) {
    if (/oauth1-permissions|permission/i.test(`${type} ${text}`) && !/reply|quote|summon/i.test(text)) {
      return new XApiError("permissions", PERMISSIONS_HELP, status)
    }
    if (/duplicate/i.test(text)) {
      return new XApiError("duplicate", "X refused this as a duplicate of a post you already made.", status)
    }
    const hints: string[] = []
    if (context.reply) hints.push("On pay-per-use, X only accepts API replies when the post's author mentioned or quoted you.")
    if (context.quote) hints.push("X only allows quote posts through the API on Enterprise plans.")
    return new XApiError("forbidden", [`X refused the request (403)${detail}.`, ...hints].join(" "), status)
  }
  if (status === 402) {
    return new XApiError("billing", `X says payment is required (402)${detail}. Add credits in the X developer portal.`, status)
  }
  if (status === 429) {
    const retryAt = rateLimitResetAt(headers)
    return new XApiError("rate-limit", `X rate limit reached. Trying again after ${timeLabel(retryAt)}.`, status, retryAt)
  }
  if (status >= 500) {
    return new XApiError("server", `X had a server error (${status})${detail}.`, status)
  }
  return new XApiError("invalid", `X refused the request (${status})${detail}.`, status)
}
