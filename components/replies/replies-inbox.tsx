import { InboxIcon, KeyRoundIcon } from "lucide-react"
import Link from "next/link"
import { connection } from "next/server"

import { MentionCard } from "@/components/replies/mention-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { listMentions, mentionCounts, parseReplyFilter, replyFilters, type ReplyFilter } from "@/app/replies/data"
import { aiKeyStatus } from "@/lib/ai/index"
import { estimateCostUsd, estimateTokens } from "@/lib/ai/models"
import { systemPrompt } from "@/lib/ai/prompts"
import { formatNumber } from "@/lib/format"
import { getSettings } from "@/lib/get-settings"
import { readVoiceProfile } from "@/lib/voice/profile"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const FILTER_LABELS: Record<ReplyFilter, string> = {
  unhandled: "To reply",
  handled: "Handled",
  all: "All",
}

export async function RepliesInbox({ searchParams }: { searchParams: SearchParams }) {
  // The DB and secrets change outside the build: read them per request.
  await connection()
  const filter = parseReplyFilter((await searchParams).show)
  const [counts, rows, settings] = await Promise.all([mentionCounts(), listMentions(filter), getSettings()])

  if (counts.all === 0) return <EmptyInbox />

  const ai = aiKeyStatus()
  // A reply prompt is the voice profile plus a few short posts; the reply itself is short.
  const draftCostUsd =
    ai.hasKey && ai.provider && ai.model
      ? estimateCostUsd(ai.provider, ai.model, estimateTokens(systemPrompt(readVoiceProfile())) + 400, 300)
      : null

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filter mentions" className="flex flex-wrap items-center gap-1.5">
        {replyFilters.map((f) => (
          <Button key={f} asChild size="sm" variant={f === filter ? "secondary" : "ghost"}>
            <Link
              href={f === "unhandled" ? "/replies" : `/replies?show=${f}`}
              aria-current={f === filter ? "page" : undefined}
              scroll={false}
            >
              {FILTER_LABELS[f]}
              <span className="text-muted-foreground tabular-nums">{formatNumber(counts[f])}</span>
            </Link>
          </Button>
        ))}
      </nav>

      {!ai.hasKey ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <KeyRoundIcon aria-hidden="true" className="size-4 shrink-0" />
          You can write replies yourself. To get drafts in your voice,{" "}
          <Link href="/settings#ai" className="font-medium text-foreground underline underline-offset-4">
            add an AI key in Settings → AI
          </Link>
          .
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{filter === "unhandled" ? "All caught up" : "Nothing here yet"}</CardTitle>
            <CardDescription>
              {filter === "unhandled"
                ? "Every mention is handled. New ones show up here after the next sync."
                : "Mentions you reply to or mark handled show up here."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((m, i) => (
            <MentionCard
              key={m.id}
              mention={m}
              index={i}
              timeZone={settings.timeZone}
              aiReady={ai.hasKey}
              draftCostUsd={draftCostUsd}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function EmptyInbox() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <InboxIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          No mentions yet
        </CardTitle>
        <CardDescription>
          Grok Bot fetches new mentions and replies to your posts with each sync and imports them here. Once the first
          ones arrive you can draft replies in your voice, edit them, and send them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Check sync settings</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function RepliesInboxSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="flex gap-1.5">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-16" />
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  )
}
