import { formatDateTime } from "../sync/format"
import type { FileOutcome, ImportReport } from "./import"

/* Plain-language import summaries for the CLI and the worker log. */

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`

function postCounts({ posts: p }: FileOutcome) {
  const skipped = p.skipped ? `, ${p.skipped} skipped` : ""
  return `${plural(p.received, "post")} (${p.new} new, ${p.updated} updated, ${p.unchanged} unchanged${skipped})`
}

export function describeFile(o: FileOutcome): string {
  if (o.status === "failed") {
    const where = o.movedTo ? " (moved to failed/)" : o.retry ? " (left in place to retry)" : ""
    return `failed   ${o.name}${where}: ${o.reason}`
  }
  const what =
    o.kind === "mentions"
      ? `${plural(o.mentions.received, "mention")} (${o.mentions.new} new)`
      : o.kind === "inspiration"
        ? `${plural(o.inspiration.received, "inspiration post")} (${o.inspiration.new} new)`
        : o.kind === "account"
          ? "profile only"
          : postCounts(o)
  const source =
    o.format === "envelope"
      ? `${o.runType} run ${o.runId}${o.complete ? "" : ", incomplete"}`
      : o.format === "flat"
        ? "flat export"
        : "X API pages"
  const lines = [`${o.status.padEnd(8)} ${o.name} [${source}]: ${what}`]
  const changes = Object.entries(o.posts.typeChanges)
  if (changes.length) lines.push(`         type changed: ${changes.map(([k, n]) => `${k} ${n}`).join(", ")}`)
  if (o.removedSamples) lines.push(`         removed ${plural(o.removedSamples, "sample post")}`)
  if (o.reason) lines.push(`         ${o.reason}`)
  return lines.join("\n")
}

export function describeImport(report: ImportReport): string {
  const { result, files, coverage, settings } = report
  const tz = settings.timeZone
  const when = (iso: string) => formatDateTime(iso, tz)
  const lines: string[] = []
  if (files.length === 0) lines.push("Nothing to import: the inbox is empty.")
  else lines.push(`${result.status === "failed" ? "Could not import" : "Imported"} ${plural(files.length, "file")}:`)
  for (const f of files) lines.push(`  ${describeFile(f).replaceAll("\n", "\n  ")}`)
  if (report.pruned) lines.push(`Deleted ${plural(report.pruned, "processed file")} older than 14 days.`)

  lines.push("")
  lines.push(
    coverage.live && coverage.lastOkTo
      ? `Synced: complete up to ${when(coverage.lastOkTo)} (${tz}).`
      : coverage.lastOkTo
        ? `Synced: last complete up to ${when(coverage.lastOkTo)}, more than 90 days ago. A backfill is needed.`
        : "Synced: no complete sync yet. A backfill is needed."
  )
  lines.push(
    result.gap
      ? `Gap: ${when(result.gap.from)} to ${when(result.gap.to)} was never fetched. Fetch it now (catch-up).`
      : "Gap: none."
  )
  const n = result.next
  const mentions = n.mentionsSinceId ? `mentions newer than ${n.mentionsSinceId}` : "mentions from the last 7 days"
  const replies = n.repliesFrom && n.repliesFrom !== n.from ? `; replies only from ${when(n.repliesFrom)}` : ""
  lines.push(`Next run (${n.type}): fetch posts from ${when(n.from)}${replies}, plus profile and ${mentions}.`)
  return lines.join("\n")
}
