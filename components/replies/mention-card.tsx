import { ArrowUpRightIcon, EyeIcon, HeartIcon, MessageCircleIcon, type LucideIcon } from "lucide-react"

import { formatWhen, statusUrl } from "@/components/replies/format"
import { ReplyComposer } from "@/components/replies/reply-composer"
import { Badge } from "@/components/ui/badge"
import type { ContextPost, MentionView } from "@/app/replies/data"
import { decodeXEntities } from "@/lib/ai/text"
import { formatCompact, formatNumber } from "@/lib/format"
import { X_PRICES_USD } from "@/lib/spend"

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${formatNumber(value)} ${label}`}>
      <Icon aria-hidden="true" className="size-3.5 opacity-70" />
      <span className="tabular-nums">{formatCompact(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function Context({ post, label, timeZone }: { post: ContextPost; label: string; timeZone: string }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3 text-sm">
      <span className="text-xs text-muted-foreground">
        {label} &middot; <time dateTime={post.createdAt}>{formatWhen(post.createdAt, timeZone)}</time>
      </span>
      <p className="line-clamp-3 break-words whitespace-pre-wrap text-muted-foreground">{decodeXEntities(post.text)}</p>
    </div>
  )
}

const DRAFT_LABEL: Record<string, string> = {
  scheduled: "Reply queued",
  publishing: "Sending reply",
  published: "Replied",
  "needs-check": "Reply being checked",
  failed: "Reply failed",
  missed: "Reply missed",
  draft: "Reply drafted",
}

/** One mention: who, what they said, what it replies to, and the reply box. */
export function MentionCard({
  mention: m,
  index,
  timeZone,
  aiReady,
  draftCostUsd,
}: {
  mention: MentionView
  index: number
  timeZone: string
  aiReady: boolean
  draftCostUsd: number | null
}) {
  const author = m.authorUsername ? `@${m.authorUsername}` : "Someone"
  const draftStatus = m.replyDraft?.status
  return (
    <li
      className="t-rise flex min-w-0 flex-col gap-3 rounded-xl px-4 py-4 ring-1 ring-foreground/10"
      style={{ "--i": Math.min(index, 12) } as React.CSSProperties}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {m.authorUsername ? (
          <a
            href={`https://x.com/${m.authorUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate font-medium hover:underline"
          >
            {m.authorName ? <>{m.authorName} </> : null}
            <span className="font-normal text-muted-foreground">{author}</span>
          </a>
        ) : (
          <span className="font-medium">{m.authorName ?? author}</span>
        )}
        <span aria-hidden="true" className="text-muted-foreground">
          &middot;
        </span>
        <time dateTime={m.createdAt} className="text-xs text-muted-foreground tabular-nums">
          {formatWhen(m.createdAt, timeZone)}
        </time>
        {draftStatus ? (
          <Badge variant={draftStatus === "failed" || draftStatus === "missed" ? "destructive" : "secondary"}>
            {DRAFT_LABEL[draftStatus] ?? draftStatus}
          </Badge>
        ) : m.handledAt ? (
          <Badge variant="outline">Handled</Badge>
        ) : null}
        <a
          href={statusUrl(m.id, m.authorUsername)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Open on X
          <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </header>

      {m.thread.map((p) => (
        <Context key={p.id} post={p} timeZone={timeZone} label={p.mine ? "You, earlier in the thread" : `${p.author}, earlier`} />
      ))}
      {m.repliedTo ? (
        <Context
          post={m.repliedTo}
          timeZone={timeZone}
          label={m.repliedTo.mine ? "Replying to your post" : `Replying to ${m.repliedTo.author}`}
        />
      ) : m.inReplyToId ? (
        <p className="text-xs text-muted-foreground">
          Replying to{" "}
          <a href={statusUrl(m.inReplyToId)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
            a post that isn&apos;t in your local data
          </a>
        </p>
      ) : null}

      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{decodeXEntities(m.text)}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Metric icon={HeartIcon} label="likes" value={m.likes} />
        <Metric icon={MessageCircleIcon} label="replies" value={m.replies} />
        {m.impressions ? <Metric icon={EyeIcon} label="impressions" value={m.impressions} /> : null}
      </div>

      <ReplyComposer
        mentionId={m.id}
        author={author}
        handled={!!m.handledAt}
        aiReady={aiReady}
        draftCostUsd={draftCostUsd}
        replyDraft={m.replyDraft}
        xPrices={{ post: X_PRICES_USD.postCreate, withLink: X_PRICES_USD.postCreateWithUrl }}
      />
    </li>
  )
}
