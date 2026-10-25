import { ArrowUpRightIcon, QuoteIcon, ReplyIcon } from "lucide-react"

import { ItemActions, type QueueAction } from "@/components/queue/item-actions"
import { Badge } from "@/components/ui/badge"
import type { Draft } from "@/lib/db/schema"
import { draftParts, draftPublishedIds, PRICES } from "@/lib/publish"
import { formatInZone } from "@/lib/publish/zoned"
import { postUrl, type AppSettings } from "@/lib/settings"
import { isDryRunId } from "@/lib/x/client"
import { formatUsd, partsCostUsd } from "@/lib/x/text"

export type QueueSection = "missed" | "needsCheck" | "failed" | "publishing" | "scheduled" | "drafts" | "published"

const ACTIONS: Record<QueueSection, QueueAction[]> = {
  missed: ["postNow", "reschedule", "discard"],
  needsCheck: ["retry", "markPosted", "delete"],
  failed: ["retry", "reschedule", "edit", "delete"],
  publishing: [],
  scheduled: ["postNow", "edit", "unschedule", "delete"],
  drafts: ["edit", "postNow", "delete"],
  published: ["delete"],
}

/** "in 3 h", "12 min ago", "in 2 days" */
export function relativeLabel(iso: string, now: Date): string {
  const diff = Date.parse(iso) - now.getTime()
  const abs = Math.abs(diff) / 60_000
  const text = abs < 1 ? "now" : abs < 60 ? `${Math.round(abs)} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`
  if (text === "now") return "now"
  return diff > 0 ? `in ${text}` : `${text} ago`
}

function kindLabel(draft: Draft, count: number) {
  if (count > 1) return `Thread · ${count} posts`
  if (draft.kind === "reply") return "Reply"
  if (draft.kind === "quote") return "Quote"
  return "Post"
}

function timeLabel(section: QueueSection, draft: Draft, tz: string, now: Date) {
  const at = (iso: string) => `${formatInZone(iso, tz)} · ${relativeLabel(iso, now)}`
  switch (section) {
    case "scheduled":
      return draft.scheduledAt ? at(draft.scheduledAt) : "As soon as possible"
    case "missed":
    case "needsCheck":
    case "publishing":
      return draft.scheduledAt ? `Due ${at(draft.scheduledAt)}` : null
    case "failed":
      return `Failed ${at(draft.updatedAt)}`
    case "drafts":
      return `Edited ${at(draft.updatedAt)}`
    case "published":
      return `Posted ${at(draft.updatedAt)}`
  }
}

export function QueueItem({
  draft,
  section,
  settings,
  now,
  defaultLocal,
  minLocal,
}: {
  draft: Draft
  section: QueueSection
  settings: Pick<AppSettings, "timeZone" | "handle">
  now: Date
  /** Default for the reschedule picker. */
  defaultLocal: string
  minLocal: string
}) {
  const parts = draftParts(draft)
  const ids = draftPublishedIds(draft)
  const cost = draft.estCostUsd ?? partsCostUsd(parts, PRICES)
  const remaining = section === "published" ? [] : parts.slice(ids.length)
  const sendCost = partsCostUsd(remaining, PRICES)
  const actions = ACTIONS[section].filter((a) => a !== "edit" || ids.length === 0)
  const [head, ...rest] = parts

  return (
    <li className="t-rise flex flex-col gap-2.5 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="secondary">{kindLabel(draft, parts.length)}</Badge>
        {draft.origin === "ai" && <Badge variant="outline">AI</Badge>}
        <span className="tabular-nums">{timeLabel(section, draft, settings.timeZone, now)}</span>
        <span className="ml-auto tabular-nums" title="Estimated X cost">
          {formatUsd(cost)}
        </span>
      </div>

      {(draft.inReplyToId || draft.quoteId) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {draft.inReplyToId && (
            <a
              href={`https://x.com/i/status/${draft.inReplyToId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ReplyIcon className="size-3.5" aria-hidden="true" /> Replying to a post
            </a>
          )}
          {draft.quoteId && (
            <a
              href={`https://x.com/i/status/${draft.quoteId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <QuoteIcon className="size-3.5" aria-hidden="true" /> Quoting a post
            </a>
          )}
        </div>
      )}

      <p className="line-clamp-4 text-sm leading-relaxed break-words whitespace-pre-wrap">{head}</p>
      {rest.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">
            {rest.length} more {rest.length === 1 ? "post" : "posts"} in this thread
          </summary>
          <ol start={2} className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
            {rest.map((p, i) => (
              <li key={i} className="break-words whitespace-pre-wrap">
                {p}
              </li>
            ))}
          </ol>
        </details>
      )}

      {draft.error && (
        <p className={section === "scheduled" ? "text-xs text-amber-700 dark:text-amber-400" : "text-xs text-destructive"}>
          {draft.error}
        </p>
      )}

      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {section === "published" ? "On X:" : `Already on X (${ids.length} of ${parts.length}):`}
          </span>
          {ids.map((id, i) =>
            isDryRunId(id) ? (
              <Badge key={id} variant="outline" title={id}>
                dry run {ids.length > 1 ? i + 1 : ""}
              </Badge>
            ) : (
              <a
                key={id}
                href={postUrl(id, settings)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline"
              >
                {ids.length > 1 ? `Post ${i + 1}` : "View post"}
                <ArrowUpRightIcon className="size-3" aria-hidden="true" />
              </a>
            )
          )}
        </div>
      )}

      {actions.length > 0 && (
        <ItemActions
          id={draft.id}
          actions={actions}
          costLabel={`${remaining.length === 1 ? "1 post" : `${remaining.length} posts`} (${formatUsd(sendCost)})`}
          defaultLocal={defaultLocal}
          minLocal={minLocal}
          timeZone={settings.timeZone}
          deleteNote={
            section === "published"
              ? "Remove from this history? The post stays on X."
              : ids.length
                ? "Delete from the app? Parts already on X stay there."
                : "Delete this from the app?"
          }
        />
      )}
    </li>
  )
}
