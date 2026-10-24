/*
 * Small helpers for X post text. Pure, so client components can use them.
 */

/** X's API returns post text with &amp; &lt; &gt; escaped. */
export function decodeXEntities(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const BARE_DOMAIN_RE = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|io|ai|co|app|dev|so|me|xyz|in|gg|tv|ly)\b/i
const EMOJI_RE = /\p{Extended_Pictographic}/u
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })
/** Every link counts as 23 characters on X (t.co). */
const URL_WEIGHT = 23

/** X counts most Latin text as 1 and CJK, emoji and similar as 2 (twitter-text v3 ranges). */
function codePointWeight(cp: number): number {
  return cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2
}

/** Approximate X character count (links = 23, emoji = 2). */
export function xLength(text: string): number {
  let length = 0
  const rest = text.normalize("NFC").replace(URL_RE, () => {
    length += URL_WEIGHT
    return ""
  })
  for (const { segment } of segmenter.segment(rest)) {
    if (EMOJI_RE.test(segment)) {
      length += 2
      continue
    }
    for (const ch of segment) length += codePointWeight(ch.codePointAt(0) ?? 0)
  }
  return length
}

/** Standard post limit without X Premium. */
export const X_POST_LIMIT = 280

/** X charges more for posts with a link ($0.20 vs $0.015). */
export const hasLink = (text: string) => new RegExp(URL_RE.source, "i").test(text) || BARE_DOMAIN_RE.test(text)
