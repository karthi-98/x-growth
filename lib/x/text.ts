/*
 * Post text rules that the compose editor (browser) and the publisher
 * (server) share, so this file has no Node or DB imports.
 *
 * Weighted length follows X's twitter-text v3 config: text is NFC-normalized,
 * code points in the Latin/common ranges below weigh 1, everything else
 * (CJK, most symbols) weighs 2, an emoji sequence weighs 2 in total, and every
 * URL counts as 23 whatever its length. The limit is 280.
 */

export const MAX_POST_LENGTH = 280
export const URL_WEIGHT = 23

/** Code point ranges that weigh 1 (twitter-text v3 `ranges`). */
const LIGHT_RANGES: [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
]

const isLight = (cp: number) => LIGHT_RANGES.some(([a, b]) => cp >= a && cp <= b)

const EXT_PICT = /\p{Extended_Pictographic}/u
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u

/** True when a grapheme cluster is an emoji (single, ZWJ sequence, flag, keycap, skin tone). */
function isEmojiGrapheme(g: string): boolean {
  if (g.includes("⃣") || g.includes("️") || REGIONAL_INDICATOR.test(g)) return true
  for (const ch of g) if (ch.codePointAt(0)! > 0xff && EXT_PICT.test(ch)) return true
  return false
}

let segmenter: Intl.Segmenter | null | undefined
function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null
  }
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text)
}

/** Weight of plain text (no URLs) in X units. */
function plainWeight(text: string): number {
  let units = 0
  for (const g of graphemes(text)) {
    if (isEmojiGrapheme(g)) {
      units += 2
      continue
    }
    for (const ch of g) units += isLight(ch.codePointAt(0)!) ? 1 : 2
  }
  return units
}

/*
 * URL detection: an approximation of twitter-text's extractor. Links with a
 * scheme always count; bare domains count when they end in a common TLD (a
 * two-letter TLD that is also an English word, like ".so" or ".to", needs a
 * path). Over-detecting is the safe side for the $0.20 link price warning.
 */
const SCHEME_URL = /\bhttps?:\/\/[^\s<>"]+/gi
const TLDS =
  "com|net|org|edu|gov|info|biz|dev|app|xyz|link|site|online|tech|blog|store|page|club|news|live|io|ai|co|tv|gg|ly|fm|sh|so|to|me|in|us|uk|ca|de|fr|jp|au|nl|es|it|br"
const BARE_URL = new RegExp(
  `(?<![\\w@.\\-/:#$])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(${TLDS})(?![a-z0-9-])(?::\\d{1,5})?(\\/[^\\s<>"]*)?`,
  "gi"
)
const WORD_TLDS = new Set(["so", "to", "me", "in", "us", "it"])
const TRAILING_PUNCT = /[.,:;!?'"\]}>]+$/

function trimUrl(url: string): string {
  let out = url.replace(TRAILING_PUNCT, "")
  // Drop an unbalanced closing paren: "(see example.com)".
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) {
    out = out.slice(0, -1).replace(TRAILING_PUNCT, "")
  }
  return out
}

export type UrlMatch = { url: string; start: number; end: number }

/** URLs in post text, in order. */
export function extractUrls(text: string): UrlMatch[] {
  const found: UrlMatch[] = []
  for (const m of text.matchAll(SCHEME_URL)) {
    const url = trimUrl(m[0])
    if (url.length > "https://".length) found.push({ url, start: m.index!, end: m.index! + url.length })
  }
  for (const m of text.matchAll(BARE_URL)) {
    const start = m.index!
    if (found.some((f) => start < f.end && start + m[0].length > f.start)) continue
    if (WORD_TLDS.has(m[1].toLowerCase()) && !m[2]) continue
    const url = trimUrl(m[0])
    found.push({ url, start, end: start + url.length })
  }
  return found.sort((a, b) => a.start - b.start)
}

export const containsUrl = (text: string) => extractUrls(text).length > 0

/** X's weighted length of a post (limit MAX_POST_LENGTH). */
export function weightedLength(text: string): number {
  const normalized = text.normalize("NFC")
  let units = 0
  let at = 0
  for (const { start, end } of extractUrls(normalized)) {
    units += plainWeight(normalized.slice(at, start)) + URL_WEIGHT
    at = end
  }
  return units + plainWeight(normalized.slice(at))
}

/**
 * Post id from a pasted x.com / twitter.com status URL or a bare id;
 * null when it isn't one.
 */
export function parsePostRef(input: string): string | null {
  const value = input.trim()
  if (/^\d{1,19}$/.test(value)) return value
  const m = value.match(
    /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i(?:\/web)?)\/status(?:es)?\/(\d{1,19})(?:[/?#].*)?$/i
  )
  return m ? m[1] : null
}

/** Per-post prices, passed in so the browser bundle never imports lib/spend.ts. */
export type XPostPrices = { post: number; postWithUrl: number }

export const partCostUsd = (text: string, prices: XPostPrices) =>
  containsUrl(text) ? prices.postWithUrl : prices.post

/** Estimated cost of sending these parts (one post each). */
export const partsCostUsd = (parts: string[], prices: XPostPrices) =>
  parts.reduce((sum, p) => sum + partCostUsd(p, prices), 0)

/** "$0.015", "$0.20", "$1.25" */
export function formatUsd(amount: number): string {
  const digits = amount > 0 && amount < 0.1 ? 3 : 2
  return `$${amount.toFixed(digits)}`
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }

/**
 * Text reduced for matching a sent part against a synced post: X returns
 * HTML entities, t.co links in place of URLs and may prefix reply mentions.
 */
export function normalizeForMatch(text: string): string {
  let out = text.normalize("NFC").replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e])
  const urls = extractUrls(out)
  for (let i = urls.length - 1; i >= 0; i--) out = `${out.slice(0, urls[i].start)}\u0000${out.slice(urls[i].end)}`
  return out
    .replace(/^(?:@\w{1,15}\s+)+/, "")
    .replace(/\s+/g, " ")
    .trim()
}
