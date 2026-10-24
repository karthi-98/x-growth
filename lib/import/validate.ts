import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportKinds,
  type ApiPost,
  type ApiUser,
  type ExportEnvelope,
  type RunTrigger,
  type RunType,
} from "../contract/envelope"

/*
 * Runtime check for inbox envelopes (docs/ARCHITECTURE.md sections 6.2, 6.3
 * and 10). Inbox files are untrusted: anything that doesn't match the v1
 * shape is rejected with a reason a person can act on. Unknown extra fields
 * (X adds some, e.g. edit_history_tweet_ids) are allowed and ignored.
 */

export const MAX_ENVELOPE_BYTES = 20 * 1024 * 1024

const runTypes: readonly RunType[] = ["backfill", "full", "light", "catch-up"]
const runTriggers: readonly RunTrigger[] = ["schedule", "webhook", "manual", "cli"]
const ID_RE = /^\d{1,25}$/
const RUN_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/
const USERNAME_RE = /^[A-Za-z0-9_]{1,50}$/
/** fetched_at may run ahead of this computer's clock by at most this much. */
const MAX_CLOCK_SKEW_MS = 24 * 3_600_000

export type ValidateOptions = {
  /** File size on disk. */
  sizeBytes: number
  /** settings.userId; null adopts the envelope's account. */
  userId: string | null
  now?: Date
}

export type ValidateResult = { ok: true; envelope: ExportEnvelope } | { ok: false; reason: string }

class Invalid extends Error {}

function fail(path: string, problem: string): never {
  throw new Invalid(`${path} ${problem}`)
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

function str(v: unknown, path: string, opts: { optional?: boolean; max?: number } = {}): string | undefined {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined
    fail(path, "is missing")
  }
  if (typeof v !== "string") fail(path, "must be a string")
  const s = v as string
  if (!opts.optional && s.length === 0) fail(path, "is empty")
  if (opts.max && s.length > opts.max) fail(path, `is longer than ${opts.max} characters`)
  return s
}

function id(v: unknown, path: string, optional = false): string | undefined {
  const s = str(v, path, { optional })
  if (s !== undefined && !ID_RE.test(s)) fail(path, `must be a numeric X id, got "${s.slice(0, 40)}"`)
  return s
}

function date(v: unknown, path: string): string {
  const s = str(v, path)!
  const t = Date.parse(s)
  if (!Number.isFinite(t)) fail(path, `is not a valid date: "${s.slice(0, 40)}"`)
  const year = new Date(t).getUTCFullYear()
  if (year < 2006 || year > 2100) fail(path, `is out of range: "${s}"`)
  return s
}

function count(v: unknown, path: string): void {
  if (v === undefined) return
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(path, "must be a whole number >= 0")
}

function metrics(v: unknown, path: string, keys: string[]): void {
  if (v === undefined) return
  if (!isObject(v)) fail(path, "must be an object")
  for (const k of keys) count((v as Record<string, unknown>)[k], `${path}.${k}`)
}

const postMetricKeys = ["impression_count", "like_count", "reply_count", "retweet_count", "quote_count", "bookmark_count"]
const userMetricKeys = ["followers_count", "following_count", "tweet_count", "listed_count"]

function user(v: unknown, path: string): ApiUser {
  if (!isObject(v)) fail(path, "must be an object")
  const u = v as Record<string, unknown>
  id(u.id, `${path}.id`)
  const username = str(u.username, `${path}.username`)!
  if (!USERNAME_RE.test(username)) fail(`${path}.username`, `is not a valid X handle: "${username.slice(0, 40)}"`)
  str(u.name, `${path}.name`, { optional: true, max: 200 })
  str(u.profile_image_url, `${path}.profile_image_url`, { optional: true, max: 2000 })
  metrics(u.public_metrics, `${path}.public_metrics`, userMetricKeys)
  return v as ApiUser
}

function post(v: unknown, path: string, needsAuthor: boolean): ApiPost {
  if (!isObject(v)) fail(path, "must be an object")
  const p = v as Record<string, unknown>
  id(p.id, `${path}.id`)
  if (typeof p.text !== "string") fail(`${path}.text`, "must be a string")
  if ((p.text as string).length > 100_000) fail(`${path}.text`, "is too long")
  date(p.created_at, `${path}.created_at`)
  id(p.author_id, `${path}.author_id`, !needsAuthor)
  id(p.conversation_id, `${path}.conversation_id`, true)
  id(p.in_reply_to_user_id, `${path}.in_reply_to_user_id`, true)
  str(p.lang, `${path}.lang`, { optional: true, max: 20 })
  if (p.referenced_tweets !== undefined && p.referenced_tweets !== null) {
    if (!Array.isArray(p.referenced_tweets)) fail(`${path}.referenced_tweets`, "must be an array")
    ;(p.referenced_tweets as unknown[]).forEach((r, i) => {
      const rp = `${path}.referenced_tweets[${i}]`
      if (!isObject(r)) fail(rp, "must be an object")
      str((r as Record<string, unknown>).type, `${rp}.type`, { max: 40 })
      id((r as Record<string, unknown>).id, `${rp}.id`)
    })
  }
  metrics(p.public_metrics, `${path}.public_metrics`, postMetricKeys)
  metrics(p.non_public_metrics, `${path}.non_public_metrics`, ["impression_count"])
  return v as ApiPost
}

/** True when the JSON claims to be an envelope (has a `format` field), valid or not. */
export const looksLikeEnvelope = (raw: unknown) => isObject(raw) && "format" in raw

/** Why a file is too large to import, or null. Checked before reading inbox files. */
export function sizeProblem(sizeBytes: number): string | null {
  if (sizeBytes <= MAX_ENVELOPE_BYTES) return null
  const mb = (sizeBytes / 1024 / 1024).toFixed(1)
  return `File is ${mb} MB; the limit is 20 MB. Split it into files of at most 1,000 posts.`
}

export function validateEnvelope(raw: unknown, opts: ValidateOptions): ValidateResult {
  try {
    const tooBig = sizeProblem(opts.sizeBytes)
    if (tooBig) throw new Invalid(tooBig)
    if (!isObject(raw)) throw new Invalid("File must be a JSON object (an xstats-export envelope).")
    if (raw.format !== EXPORT_FORMAT) {
      throw new Invalid(`Unknown format ${JSON.stringify(raw.format)}; expected "${EXPORT_FORMAT}".`)
    }
    if (raw.version !== EXPORT_VERSION) {
      throw new Invalid(
        `Unsupported export version ${JSON.stringify(raw.version)}; this app reads version ${EXPORT_VERSION}. ` +
          `Update X Growth, or have Grok Bot write version ${EXPORT_VERSION}.`
      )
    }
    if (!exportKinds.includes(raw.kind as never)) {
      fail("kind", `must be one of ${exportKinds.join(", ")}, got ${JSON.stringify(raw.kind)}`)
    }
    const kind = raw.kind as ExportEnvelope["kind"]

    if (!isObject(raw.run)) fail("run", "must be an object")
    const run = raw.run as Record<string, unknown>
    const runId = str(run.id, "run.id")!
    if (!RUN_ID_RE.test(runId)) fail("run.id", "may only use letters, digits and . _ : - (up to 64)")
    if (!runTypes.includes(run.type as RunType)) fail("run.type", `must be one of ${runTypes.join(", ")}`)
    if (!runTriggers.includes(run.trigger as RunTrigger)) {
      fail("run.trigger", `must be one of ${runTriggers.join(", ")}`)
    }
    str(run.source, "run.source", { max: 100 })

    const fetchedAt = date(raw.fetched_at, "fetched_at")
    const now = (opts.now ?? new Date()).getTime()
    if (Date.parse(fetchedAt) > now + MAX_CLOCK_SKEW_MS) {
      fail("fetched_at", "is more than a day in the future; check the computer's clock")
    }

    const account = user(raw.account, "account")
    if (opts.userId && account.id !== opts.userId) {
      throw new Invalid(
        `This file is for X account @${account.username} (id ${account.id}), but this app is set up for user id ${opts.userId}.`
      )
    }

    if (!isObject(raw.window)) fail("window", "must be an object")
    const window = raw.window as Record<string, unknown>
    const start = Date.parse(date(window.start_time, "window.start_time"))
    const end = Date.parse(date(window.end_time, "window.end_time"))
    if (start > end) fail("window", "starts after it ends")

    if (typeof raw.complete !== "boolean") fail("complete", "must be true or false")
    if (typeof raw.rate_limited !== "boolean") fail("rate_limited", "must be true or false")
    if (!Array.isArray(raw.errors)) fail("errors", "must be an array")
    if (!Array.isArray(raw.data)) fail("data", "must be an array")

    const needsAuthor = kind === "mentions" || kind === "inspiration"
    ;(raw.data as unknown[]).forEach((p, i) => post(p, `data[${i}]`, needsAuthor))
    if (raw.users !== undefined) {
      if (!Array.isArray(raw.users)) fail("users", "must be an array")
      ;(raw.users as unknown[]).forEach((u, i) => user(u, `users[${i}]`))
    }

    return { ok: true, envelope: raw as unknown as ExportEnvelope }
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, reason: err.message }
    throw err
  }
}
