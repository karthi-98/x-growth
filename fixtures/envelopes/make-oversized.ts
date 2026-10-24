/**
 * Write an otherwise valid envelope that is over the import's 20 MB limit
 * (docs/ARCHITECTURE.md section 6.3), for testing the size check. Too big to
 * commit, so it is generated into the git-ignored data folder.
 *
 *   bun fixtures/envelopes/make-oversized.ts [outDir]   (default data/fixtures)
 *
 * Synthetic data only: 1,000 posts (the bot's cap) with long texts, for the
 * same account as the other fixtures.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { EXPORT_FORMAT, EXPORT_VERSION, type ApiPost, type ExportEnvelope } from "../../lib/contract/envelope"

const outDir = process.argv[2] ?? path.join("data", "fixtures")
const start = Date.parse("2026-10-17T02:30:00Z")
const end = Date.parse("2026-10-24T02:30:00Z")
const filler = "Synthetic long post for the size limit test. ".repeat(500)

const data: ApiPost[] = Array.from({ length: 1000 }, (_, i) => {
  const id = `21100000000000${String(i).padStart(5, "0")}`
  return {
    id,
    text: `${i + 1}. ${filler}`,
    created_at: new Date(start + (i + 1) * 600_000).toISOString(),
    conversation_id: id,
    lang: "en",
    public_metrics: {
      retweet_count: 0,
      reply_count: 0,
      like_count: i % 7,
      quote_count: 0,
      bookmark_count: 0,
      impression_count: 100 + i,
    },
  }
})

const envelope: ExportEnvelope = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  kind: "posts",
  run: { id: "rbadsize", type: "full", trigger: "schedule", source: "grok-bot-x-connector" },
  fetched_at: "2026-10-24T02:31:02Z",
  account: {
    id: "1000000000000000001",
    username: "xgrowth_demo",
    public_metrics: { followers_count: 1204, following_count: 287, tweet_count: 3251, listed_count: 12 },
  },
  window: { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() },
  complete: true,
  rate_limited: false,
  errors: [],
  data,
}

const json = JSON.stringify(envelope)
mkdirSync(outDir, { recursive: true })
const file = path.join(outDir, "posts-20261024T023000Z-rbadsize.json")
writeFileSync(file, json)
console.log(`Wrote ${file} (${(json.length / 1024 / 1024).toFixed(1)} MB, ${data.length} posts)`)
