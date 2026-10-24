/**
 * Import X posts from saved JSON files into data/x-stats.db.
 *
 *   bun run db:import data/imports/posts-since-2026-06-01.json [data/imports/daily-since-2026-06-01.json]
 *
 * A thin wrapper over lib/import (same as `xstats import <file>`), which
 * reads xstats-export envelopes, flat exports and raw X API pages. Files
 * outside data/inbox stay where they are.
 *
 * With a daily file (per-day sums from the same export, in the settings
 * timezone), prints the days whose rebuilt daily_stats differ from it.
 */
import { existsSync, readFileSync } from "node:fs"

import { paths } from "../lib/paths"

type DailyRow = {
  date: string
  posts: number
  impressions: number
  likes: number
  replies: number
  reposts: number
  bookmarks: number
}

const [file, dailyFile] = process.argv.slice(2)
if (!file) {
  console.error("Usage: bun run db:import <posts.json> [daily.json]")
  process.exit(1)
}
if (!existsSync(paths.data)) {
  console.error('No data folder yet. Run "bun run xstats setup" first.')
  process.exit(1)
}

const { importFiles } = await import("../lib/import")
const { describeImport } = await import("../lib/import/describe")
const report = await importFiles([file])
if (!report) {
  console.error("Another import is still running. Try again in a minute.")
  process.exit(1)
}
console.log(describeImport(report))
if (report.result.status === "failed") process.exit(1)

if (dailyFile) {
  const { inArray } = await import("drizzle-orm")
  const { db } = await import("../lib/db/client")
  const { dailyStats } = await import("../lib/db/schema")
  const daily: DailyRow[] = JSON.parse(readFileSync(dailyFile, "utf8"))
  const stored = new Map(
    (await db.select().from(dailyStats).where(inArray(dailyStats.date, daily.map((d) => d.date)))).map((d) => [d.date, d])
  )
  const keys = ["posts", "impressions", "likes", "replies", "reposts", "bookmarks"] as const
  const diffs: string[] = []
  for (const d of daily) {
    const mine = stored.get(d.date)
    if (!mine) {
      if (keys.some((k) => d[k] !== 0)) diffs.push(`${d.date}: in daily file only (${d.posts} posts)`)
      continue
    }
    const delta = keys.filter((k) => mine[k] !== d[k]).map((k) => `${k} ${mine[k]} vs ${d[k]}`)
    if (delta.length) diffs.push(`${d.date}: ${delta.join(", ")}`)
  }
  console.log(
    diffs.length
      ? `Daily file differs on ${diffs.length} days (db vs file):\n  ${diffs.join("\n  ")}`
      : `Daily file matches daily_stats on all ${daily.length} days (days outside the post range are zero).`
  )
}
