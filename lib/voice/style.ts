/*
 * A short, local description of how someone writes, from their own posts.
 * Plain heuristics, no AI call: free, instant and the same every time.
 */

export type VoiceStats = {
  posts: number
  medianChars: number
  /** Shares of posts (0..1) that show each habit. */
  lineBreaks: number
  emoji: number
  hashtags: number
  questions: number
  exclamations: number
  allCaps: number
  firstPerson: number
  lowercaseStart: number
  topEmoji: string[]
}

const EMOJI_RE = /\p{Extended_Pictographic}/u
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" })

const share = (texts: string[], test: (t: string) => boolean) =>
  texts.length ? texts.filter(test).length / texts.length : 0

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function topEmoji(texts: string[], n = 4): string[] {
  const counts = new Map<string, number>()
  for (const t of texts) {
    for (const { segment } of segmenter.segment(t)) {
      if (EMOJI_RE.test(segment)) counts.set(segment, (counts.get(segment) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([e]) => e)
}

export function voiceStats(texts: string[]): VoiceStats {
  return {
    posts: texts.length,
    medianChars: median(texts.map((t) => [...t].length)),
    lineBreaks: share(texts, (t) => t.includes("\n")),
    emoji: share(texts, (t) => EMOJI_RE.test(t)),
    hashtags: share(texts, (t) => /(^|\s)#\w/u.test(t)),
    questions: share(texts, (t) => t.includes("?")),
    exclamations: share(texts, (t) => t.includes("!")),
    allCaps: share(texts, (t) => /\b[A-Z]{4,}\b/.test(t)),
    firstPerson: share(texts, (t) => /\b(I|I'm|I’m|I've|I’ve|my|me)\b/.test(t)),
    lowercaseStart: share(texts, (t) => /^\p{Ll}/u.test(t)),
    topEmoji: topEmoji(texts),
  }
}

/** A few plain sentences for the prompt and the Settings page. */
export function describeVoice(s: VoiceStats): string[] {
  if (!s.posts) return ["No past posts to learn from yet: write in a clear, friendly, casual tone."]
  const lines: string[] = []
  const chars = Math.max(10, Math.round(s.medianChars / 10) * 10)
  if (s.medianChars < 80) lines.push(`Short posts: usually around ${chars} characters.`)
  else if (s.medianChars <= 180) lines.push(`Medium-length posts: usually around ${chars} characters.`)
  else lines.push("Longer posts, often several short paragraphs.")

  lines.push(
    s.lineBreaks >= 0.4
      ? "Splits thoughts into short lines with blank lines between them."
      : "Usually one or two lines without line breaks."
  )

  const fav = s.topEmoji.length ? ` (favourites: ${s.topEmoji.join(" ")})` : ""
  if (s.emoji >= 0.5) lines.push(`Uses emoji in most posts${fav}.`)
  else if (s.emoji >= 0.15) lines.push(`Uses emoji now and then${fav}.`)
  else lines.push("Rarely uses emoji.")

  lines.push(s.hashtags < 0.1 ? "Doesn't use hashtags." : "Sometimes adds hashtags.")
  if (s.firstPerson >= 0.5) lines.push("Personal, first-person updates about their own journey.")
  if (s.questions >= 0.3) lines.push("Often asks the audience a question.")
  if (s.exclamations >= 0.4) lines.push("Energetic, excited tone with exclamation marks.")
  if (s.allCaps >= 0.2) lines.push("Uses ALL CAPS words for emphasis.")
  if (s.lowercaseStart >= 0.5) lines.push("Often starts posts in lowercase.")
  return lines
}

const STOPWORDS = new Set(
  `about above after again against also always another because been before being below between both
  cant could didnt does doing dont down during each even every from further gonna have having here hers
  herself himself into its itself just know like make more most much must myself never next only other
  ours over own really same should some such than that thats their theirs them themselves then there
  these they thing things think this those through today very want were what when where which while
  will with would your yours yourself youre still going getting got good great time first last back
  well need wont doesnt ive youve lets every days people guys anyone someone everyone week month year
  maybe`.split(/\s+/)
)

/** Words that show up across several posts: rough topics for post ideas. */
export function topThemes(texts: string[], n = 8): string[] {
  const df = new Map<string, number>()
  for (const t of texts) {
    const words = new Set(
      t
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[’']/g, "")
        .match(/\p{L}[\p{L}\p{N}]{3,}/gu) ?? []
    )
    for (const w of words) if (!STOPWORDS.has(w)) df.set(w, (df.get(w) ?? 0) + 1)
  }
  return [...df.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([w]) => w)
}
