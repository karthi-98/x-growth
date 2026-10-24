/**
 * Simulate the X Growth Bot: turn a raw X API export into version 1 envelope
 * files in data/inbox/, following the same rules as the bot's skills
 * (docs/grok-bot/skills/xgrowth-sync.md and xgrowth-backfill.md), so the
 * import can be tested without Grok Bot.
 *
 *   bun run simulate-bot <export.json> [flags]
 *   bun run xstats import --inbox --json
 *
 * Input shapes:
 * - A raw X API export: { data: [...], user?, fetched_at?, errors?, includes?, params? },
 *   an array of such pages, or a bare array of API posts.
 * - A flat export (rows with `type` and flat metrics, as db:import reads):
 *   converted back to API objects.
 *
 * Flags:
 *   --type backfill|full|light|catch-up   run type (default light)
 *   --from <ISO> --to <ISO>               window; --to defaults to the export's
 *                                         fetch time, --from to --to minus 90 days,
 *                                         7 days or 24 hours (required for catch-up)
 *   --chunk <n>                           posts per file (default 1000, the bot's cap)
 *   --partial                             stop as if the read limit hit after half the posts
 *   --kind posts|mentions|inspiration|account   (default posts)
 *   --account-id <id> --username <name>   override or supply the account
 *   --trigger schedule|webhook|manual|cli (default manual)
 *   --run-id <id>                         (default r + 5 random characters)
 *   --out <dir>                           (default data/inbox)
 *
 * Like the bot, it drops reposts from posts runs (exclude=retweets), reads in
 * 7-day slices oldest first, cuts files of at most --chunk posts whose windows
 * join with no holes, never splits one created_at second across files, writes
 * <name>.part then renames, and escapes non-ASCII as \uXXXX.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"

import { flagString, parseArgs } from "../cli/util"
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportKinds,
  type ApiPost,
  type ApiRef,
  type ApiUser,
  type ExportEnvelope,
  type ExportKind,
  type RunTrigger,
  type RunType,
} from "../lib/contract/envelope"
import { paths } from "../lib/paths"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const SLICE_MS = 7 * DAY
const MAX_FILE_BYTES = 20 * 1024 * 1024
const runTypes: RunType[] = ["backfill", "full", "light", "catch-up"]
const triggers: RunTrigger[] = ["schedule", "webhook", "manual", "cli"]
const defaultSpan: Record<Exclude<RunType, "catch-up">, number> = {
  backfill: 90 * DAY,
  full: 7 * DAY,
  light: 24 * HOUR,
}

type FlatPost = {
  id: string
  created_at: string
  text: string
  type: string
  url?: string
  impressions?: number
  likes?: number
  replies?: number
  reposts?: number
  bookmarks?: number
  quotes?: number
  fetched_at?: string
  conversation_id?: string | null
  in_reply_to_user_id?: string | null
  lang?: string | null
  referenced_tweets?: ApiRef[] | null
}

type Input = {
  shape: string
  posts: ApiPost[]
  users: ApiUser[]
  user?: Partial<ApiUser>
  fetchedAt?: string
  coverageStart?: string
  errors: unknown[]
}

function fail(message: string): never {
  console.error(`simulate-bot: ${message}`)
  process.exit(1)
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

const isFlat = (p: unknown): p is FlatPost =>
  isObject(p) && typeof p.type === "string" && typeof p.impressions === "number"

/** UTC ISO to the whole second, as the bot writes it: 2026-10-24T07:30:00Z. */
const isoSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z")

/** yyyyMMddTHHmmssZ for file names. */
const stamp = (ms: number) => isoSeconds(ms).replace(/[-:]/g, "")

const createdMs = (p: ApiPost) => Date.parse(p.created_at)

function fromFlat(p: FlatPost): ApiPost {
  return {
    id: p.id,
    text: p.text,
    created_at: new Date(p.created_at).toISOString(),
    ...(p.conversation_id ? { conversation_id: p.conversation_id } : {}),
    ...(p.in_reply_to_user_id ? { in_reply_to_user_id: p.in_reply_to_user_id } : {}),
    ...(p.lang ? { lang: p.lang } : {}),
    ...(p.referenced_tweets?.length ? { referenced_tweets: p.referenced_tweets } : {}),
    public_metrics: {
      retweet_count: p.reposts ?? 0,
      reply_count: p.replies ?? 0,
      like_count: p.likes ?? 0,
      quote_count: p.quotes ?? 0,
      bookmark_count: p.bookmarks ?? 0,
      impression_count: p.impressions ?? 0,
    },
  }
}

function readInput(file: string): Input {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, "utf8"))
  } catch (err) {
    fail(`can't read ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (isObject(raw) && raw.format === EXPORT_FORMAT) fail(`${file} is already an envelope`)
  if (isObject(raw) && Array.isArray(raw.posts)) raw = raw.posts

  const items: unknown[] = Array.isArray(raw) ? raw : [raw]
  if (items.length > 0 && items.every(isFlat)) {
    const fetched = items.map((p) => p.fetched_at).filter((t): t is string => !!t).sort()
    const handle = items.map((p) => p.url?.match(/x\.com\/([^/]+)\/status\//)?.[1]).find(Boolean)
    return {
      shape: "flat export",
      posts: items.map(fromFlat),
      users: [],
      user: handle ? { username: handle } : undefined,
      fetchedAt: fetched.at(-1),
      errors: [],
    }
  }

  const pages = items.filter((p) => isObject(p) && Array.isArray(p.data)) as Record<string, unknown>[]
  if (pages.length === 0) {
    return { shape: "array of API posts", posts: items as ApiPost[], users: [], errors: [] }
  }
  const first = pages[0]
  const params = isObject(first.params) ? first.params : {}
  return {
    shape: pages.length > 1 ? `${pages.length} API pages` : "X API export",
    posts: pages.flatMap((p) => p.data as ApiPost[]),
    users: pages.flatMap((p) => (isObject(p.includes) && Array.isArray(p.includes.users) ? (p.includes.users as ApiUser[]) : [])),
    user: isObject(first.user) ? (first.user as Partial<ApiUser>) : undefined,
    fetchedAt: typeof first.fetched_at === "string" ? first.fetched_at : undefined,
    coverageStart: typeof params.start_time === "string" ? params.start_time : undefined,
    errors: pages.flatMap((p) => (Array.isArray(p.errors) ? p.errors : [])),
  }
}

/** A --flag time, truncated to the second. */
function parseTime(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) fail(`--${flag} "${value}" is not a date`)
  return Math.floor(ms / 1000) * 1000
}

/** A time from the export file, truncated to the second; undefined if missing or invalid. */
function fileTime(value: string | undefined): number | undefined {
  const ms = value ? Date.parse(value) : NaN
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000) * 1000
}

/** Cut sorted posts into groups of at most `size`, never splitting one created_at second. */
function cutChunks(posts: ApiPost[], size: number): ApiPost[][] {
  const second = (p: ApiPost) => Math.floor(createdMs(p) / 1000)
  const out: ApiPost[][] = []
  let start = 0
  while (start < posts.length) {
    let end = Math.min(start + size, posts.length)
    if (end < posts.length) {
      let e = end
      while (e > start && second(posts[e]) === second(posts[e - 1])) e--
      // A whole chunk inside one second can't be kept together; split it anyway.
      if (e > start) end = e
    }
    out.push(posts.slice(start, end))
    start = end
  }
  return out
}

/** JSON on one line with every non-ASCII code unit escaped, as the bot writes it. */
const toAsciiJson = (value: unknown) =>
  JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)

// --- arguments --------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
const file = args.positionals[0]
if (!file) fail("usage: bun run simulate-bot <export.json> [--type light] [--from ISO] [--to ISO] [--chunk 1000] [--partial] [--kind posts] [--account-id ID]")

const type = (flagString(args, "type") ?? "light") as RunType
if (!runTypes.includes(type)) fail(`--type must be one of ${runTypes.join(", ")}`)
const kind = (flagString(args, "kind") ?? "posts") as ExportKind
if (!exportKinds.includes(kind)) fail(`--kind must be one of ${exportKinds.join(", ")}`)
const trigger = (flagString(args, "trigger") ?? "manual") as RunTrigger
if (!triggers.includes(trigger)) fail(`--trigger must be one of ${triggers.join(", ")}`)
const chunk = Number(flagString(args, "chunk") ?? 1000)
if (!Number.isInteger(chunk) || chunk < 1) fail("--chunk must be a positive whole number")
if (chunk > 1000) console.warn(`simulate-bot: --chunk ${chunk} is above the bot's cap of 1,000 posts per file`)
const partial = args.flags.partial === true
const outDir = flagString(args, "out") ?? paths.inbox
const runId = flagString(args, "run-id") ?? `r${Math.random().toString(36).slice(2, 7).padEnd(5, "0")}`

const input = readInput(file)

// --- account ----------------------------------------------------------------

const accountId =
  flagString(args, "account-id") ?? input.user?.id ?? (kind === "posts" ? input.posts.find((p) => p.author_id)?.author_id : undefined)
if (!accountId) fail("the export doesn't say whose it is; pass --account-id <numeric X user id>")
const username = flagString(args, "username") ?? input.user?.username
if (!username) fail("the export has no username; pass --username <handle>")
const account: ApiUser = {
  id: accountId,
  username,
  ...(input.user?.name ? { name: input.user.name } : {}),
  ...(input.user?.profile_image_url ? { profile_image_url: input.user.profile_image_url } : {}),
  ...(input.user?.public_metrics ? { public_metrics: input.user.public_metrics } : {}),
}

// --- window -----------------------------------------------------------------

const newest = Math.max(...input.posts.map(createdMs).filter((ms) => !Number.isNaN(ms)))
const fallbackTo = Math.max(fileTime(input.fetchedAt) ?? 0, Number.isFinite(newest) ? newest + 1000 : 0) || Date.now()
const to = parseTime(flagString(args, "to"), "to") ?? Math.floor(fallbackTo / 1000) * 1000
const explicitFrom = parseTime(flagString(args, "from"), "from")
if (type === "catch-up" && explicitFrom === undefined) fail("--type catch-up needs --from (the gap's start)")
let from = explicitFrom ?? to - defaultSpan[type as Exclude<RunType, "catch-up">]
const coverageStart = fileTime(input.coverageStart)
if (coverageStart !== undefined && from < coverageStart) {
  if (explicitFrom !== undefined) {
    console.warn(`simulate-bot: the export only covers from ${isoSeconds(coverageStart)}; the window is marked complete anyway`)
  } else {
    console.warn(`simulate-bot: the export only covers from ${isoSeconds(coverageStart)}; starting the window there`)
    from = coverageStart
  }
}
if (from >= to) fail(`the window is empty: ${isoSeconds(from)} → ${isoSeconds(to)}`)
const fetchedAt = isoSeconds(fileTime(input.fetchedAt) ?? to)

// --- select posts as the bot's reads would return them ----------------------

const unique = [...new Map(input.posts.map((p) => [p.id, p])).values()]
const isRepost = (p: ApiPost) => !!p.referenced_tweets?.some((r) => r.type === "retweeted")
const reposts = kind === "posts" ? unique.filter(isRepost).length : 0
const inWindow = unique
  .filter((p) => (kind === "posts" ? !isRepost(p) : true))
  .filter((p) => createdMs(p) >= from && createdMs(p) < to)
  .sort((a, b) => createdMs(a) - createdMs(b) || a.id.localeCompare(b.id))

type Part = { posts: ApiPost[]; start: number; end: number; complete: boolean }
const parts: Part[] = []
const rateLimitError = {
  title: "Too Many Requests",
  status: 429,
  detail: "Simulated read limit (simulate-bot --partial).",
}

if (kind === "account") {
  parts.push({ posts: [], start: from, end: to, complete: true })
} else if (kind !== "posts") {
  // Mentions and inspiration are read newest first in one go; a read limit loses the oldest.
  const kept = partial ? inWindow.slice(Math.ceil(inWindow.length / 2)) : inWindow
  for (const group of kept.length ? cutChunks(kept, chunk) : [[]]) {
    parts.push({ posts: group, start: from, end: to, complete: !partial })
  }
} else {
  // Posts: 7-day slices, oldest first; within a slice the bot pages newest first.
  let budget = partial ? Math.floor(inWindow.length / 2) : Infinity
  let coveredTo = from
  let cut: { start: number; posts: ApiPost[] } | null = null
  for (let start = from; start < to; start += SLICE_MS) {
    const end = Math.min(start + SLICE_MS, to)
    const slice = inWindow.filter((p) => createdMs(p) >= start && createdMs(p) < end)
    if (slice.length > budget || (partial && budget === 0)) {
      cut = { start, posts: budget > 0 ? slice.slice(slice.length - budget) : [] }
      break
    }
    budget -= slice.length
    coveredTo = end
  }
  const covered = inWindow.filter((p) => createdMs(p) < coveredTo)
  if (coveredTo > from) {
    const groups = covered.length ? cutChunks(covered, chunk) : [[]]
    groups.forEach((group, i) => {
      const start = i === 0 ? from : Math.floor(createdMs(group[0]) / 1000) * 1000
      const next = groups[i + 1]
      const end = next ? Math.floor(createdMs(next[0]) / 1000) * 1000 : coveredTo
      parts.push({ posts: group, start, end, complete: true })
    })
  }
  if (cut) {
    for (const group of cut.posts.length ? cutChunks(cut.posts, chunk) : [[]]) {
      parts.push({ posts: group, start: cut.start, end: to, complete: false })
    }
  }
}

// --- write ------------------------------------------------------------------

const users = [...new Map(input.users.map((u) => [u.id, u])).values()]
mkdirSync(outDir, { recursive: true })
console.log(
  `simulate-bot: ${unique.length} posts read (${input.shape})` +
    (reposts ? `, ${reposts} reposts dropped (exclude=retweets)` : "") +
    `; ${inWindow.length} in ${isoSeconds(from)} → ${isoSeconds(to)}`
)
console.log(`Wrote ${parts.length} file${parts.length === 1 ? "" : "s"} to ${outDir}:`)

parts.forEach((part, i) => {
  const id = parts.length > 1 ? `${runId}-${String(i + 1).padStart(2, "0")}` : runId
  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    kind,
    run: { id, type, trigger, source: "simulate-bot" },
    fetched_at: fetchedAt,
    account,
    window: { start_time: isoSeconds(part.start), end_time: isoSeconds(part.end) },
    complete: part.complete,
    rate_limited: !part.complete,
    errors: [...(i === 0 ? input.errors : []), ...(part.complete ? [] : [rateLimitError])],
    data: part.posts,
    ...(kind === "mentions" || kind === "inspiration" ? { users } : {}),
  }
  const name = `${kind}-${stamp(to)}-${id}.json`
  const json = toAsciiJson(envelope)
  if (json.length > MAX_FILE_BYTES) console.warn(`simulate-bot: ${name} is over 20 MB; the import will reject it`)
  const target = path.join(outDir, name)
  writeFileSync(`${target}.part`, json, "utf8")
  renameSync(`${target}.part`, target)
  console.log(
    `  ${name}  ${type}  ${String(part.posts.length).padStart(4)} posts  ` +
      `${envelope.window.start_time} → ${envelope.window.end_time}  ${part.complete ? "complete" : "partial (rate limited)"}`
  )
})
console.log("Next: bun run xstats import --inbox --json")
