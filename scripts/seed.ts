/**
 * DUMMY DATA ONLY. Clears both tables, then inserts 14 days of sample
 * daily_stats ending today (IST) and 30 sample posts whose text starts
 * with "[Sample]" and whose ids start with "sample-". Safe to re-run.
 */
import { addDays, istDateKey } from "../lib/dates"
import { db } from "../lib/db/client"
import {
  dailyStats,
  posts,
  type NewDailyStat,
  type NewPost,
  type PostType,
} from "../lib/db/schema"

// Deterministic PRNG so every run produces the same sample shape.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)
const between = (min: number, max: number) =>
  Math.round(min + rand() * (max - min))

const DAYS = 14
const today = istDateKey()
const dates = Array.from({ length: DAYS }, (_, i) =>
  addDays(today, i - (DAYS - 1))
)

const sampleTexts: Record<PostType, string[]> = {
  original: [
    "Design systems are a product, not a project.",
    "Shipped a new dashboard layout today. Whitespace does the heavy lifting.",
    "Three rules for better UI copy: shorter, plainer, kinder.",
    "Motion should explain, not decorate.",
    "Every pixel of padding is a decision.",
    "Wrote up how I pick type scales for dense data screens.",
    "Small detail: align numbers with tabular figures.",
    "Dark mode is a second design, not an inverted one.",
    "My favourite design tool this month is a pencil.",
    "Prototype in code once the idea survives paper.",
    "Good defaults beat endless settings.",
    "A grid is a promise you make to the reader.",
    "Restraint is a design skill.",
    "Testing a new card style for stats. Thoughts?",
    "Consistency compounds.",
  ],
  reply: [
    "Totally agree, the empty state matters as much as the full one.",
    "Try reducing the contrast on the secondary labels.",
    "Love this! What font is that?",
    "This is the way.",
    "Ha, been there. Ship it and iterate.",
    "Great thread, bookmarking for later.",
    "Spacing scale looks really balanced here.",
    "Would love a write-up on this.",
    "The micro-interaction on hover is lovely.",
    "Same experience on my side.",
  ],
  quote: [
    "This is the best explanation of design tokens I have read.",
    "Exactly why I keep my charts monochrome.",
    "Required reading for anyone building dashboards.",
    "Strong take, mostly agree.",
    "Saving this for the next design review.",
  ],
}

const typeOrder: PostType[] = [
  ...Array<PostType>(15).fill("original"),
  ...Array<PostType>(10).fill("reply"),
  ...Array<PostType>(5).fill("quote"),
].sort(() => rand() - 0.5)

const counters: Record<PostType, number> = { original: 0, reply: 0, quote: 0 }
const fetchedAt = new Date().toISOString()

const samplePosts: NewPost[] = typeOrder.map((type, i) => {
  const day = dates[Math.floor((i / typeOrder.length) * DAYS)]
  const hour = between(3, 16) // 08:30 to 21:30 IST in UTC hours
  const createdAt = new Date(
    `${day}T${String(hour).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}:00Z`
  ).toISOString()
  const base =
    type === "original"
      ? between(1800, 14000)
      : type === "quote"
        ? between(900, 5200)
        : between(120, 1600)
  const impressions = Math.round(base * (0.7 + (i / typeOrder.length) * 0.6))
  const id = `sample-${String(i + 1).padStart(2, "0")}`
  const text = sampleTexts[type][counters[type]++ % sampleTexts[type].length]
  return {
    id,
    createdAt,
    text: `[Sample] ${text}`,
    type,
    url: `https://x.com/designwkarthick/status/${id}`,
    impressions,
    likes: Math.round(impressions * (0.012 + rand() * 0.02)),
    replies: Math.round(impressions * (0.002 + rand() * 0.004)),
    reposts: Math.round(impressions * (0.001 + rand() * 0.003)),
    bookmarks: Math.round(impressions * (0.002 + rand() * 0.006)),
    quotes: Math.round(impressions * rand() * 0.001),
    fetchedAt,
  }
})

const sampleDays: NewDailyStat[] = dates.map((date, i) => {
  const trend = 1 + i * 0.035
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
  const impressions = Math.round(
    between(6500, 11000) * trend * (weekend ? 0.8 : 1)
  )
  return {
    date,
    posts: samplePosts.filter((p) => p.createdAt.startsWith(date)).length,
    impressions,
    likes: Math.round(impressions * (0.014 + rand() * 0.008)),
    replies: Math.round(impressions * (0.003 + rand() * 0.002)),
    reposts: Math.round(impressions * (0.0015 + rand() * 0.001)),
    bookmarks: Math.round(impressions * (0.003 + rand() * 0.003)),
  }
})

await db.transaction(async (tx) => {
  await tx.delete(posts)
  await tx.delete(dailyStats)
  await tx.insert(dailyStats).values(sampleDays)
  await tx.insert(posts).values(samplePosts)
})

console.log(
  `Seeded DUMMY data: ${sampleDays.length} daily_stats rows (${dates[0]} to ${today} IST), ${samplePosts.length} sample posts.`
)
