"use client"

import { CheckIcon, LoaderCircleIcon, PencilIcon, SendIcon, SparklesIcon, UndoIcon } from "lucide-react"
import Link from "next/link"
import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { draftReply, markHandled, sendReply } from "@/app/replies/actions"
import type { ReplyDraftSummary } from "@/app/replies/data"
import { formatUsd } from "@/lib/ai/models"
import { hasLink, X_POST_LIMIT, xLength } from "@/lib/ai/text"

type Busy = "draft" | "send" | "handle" | null

/** Draft (AI or by hand), edit and send a reply; or mark the mention handled. */
export function ReplyComposer({
  mentionId,
  author,
  handled,
  aiReady,
  draftCostUsd,
  replyDraft,
  xPrices,
}: {
  mentionId: string
  author: string
  handled: boolean
  aiReady: boolean
  draftCostUsd: number | null
  replyDraft: ReplyDraftSummary | null
  /** X post prices (lib/spend.ts) from the server. */
  xPrices: { post: number; withLink: number }
}) {
  const ids = useId()
  const retry = replyDraft && (replyDraft.status === "failed" || replyDraft.status === "missed")
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(retry ? replyDraft.text : "")
  const [generationId, setGenerationId] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState<string | null>(null)

  // A reply is on its way (or out): show it, nothing to do here.
  if (replyDraft && !retry) {
    return (
      <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">
          {replyDraft.status === "published"
            ? "Your reply"
            : "Your reply is queued; the publish worker sends it with your X keys."}
        </span>
        <p className="break-words whitespace-pre-wrap">{replyDraft.text}</p>
      </div>
    )
  }

  const runDraft = async () => {
    setBusy("draft")
    setError(null)
    try {
      const res = await draftReply(mentionId)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setText(res.text)
      setGenerationId(res.generationId)
      setAiNote(`Drafted with ${res.model} · cost ${formatUsd(res.estCostUsd)}. Edit it before sending.`)
      setOpen(true)
    } catch {
      setError("Couldn't reach the app server. Is it still running?")
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    setBusy("send")
    setError(null)
    try {
      const res = await sendReply({ mentionId, text, generationId })
      if (!res.ok) setError(res.error)
      // On success the page refreshes and this mention moves to Handled.
    } catch {
      setError("Couldn't reach the app server. Is it still running?")
    } finally {
      setBusy(null)
    }
  }

  const toggleHandled = async (next: boolean) => {
    setBusy("handle")
    setError(null)
    try {
      await markHandled(mentionId, next)
    } catch {
      setError("Couldn't update the mention. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const spinner = <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
  const length = xLength(text)
  const link = hasLink(text)
  const postCost = link ? xPrices.withLink : xPrices.post

  if (handled && !retry && !open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void toggleHandled(false)}>
          {busy === "handle" ? spinner : <UndoIcon aria-hidden="true" />}
          Mark as not handled
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {retry ? (
        <p className="text-sm text-destructive">
          The last reply didn&apos;t go out{replyDraft.error ? `: ${replyDraft.error}` : "."} You can edit it and send again.
        </p>
      ) : null}

      {open || retry ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-reply`} className="sr-only">
            Reply to {author}
          </label>
          <textarea
            id={`${ids}-reply`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={`Reply to ${author}`}
            className="min-h-20 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            aria-describedby={`${ids}-meta`}
          />
          <div id={`${ids}-meta`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {aiNote ?? "Written by you."} Sending posts it with your X keys for about {formatUsd(postCost)}
              {link ? " (links cost more on X)" : ""}.
            </span>
            <span className={length > X_POST_LIMIT ? "text-destructive tabular-nums" : "tabular-nums"}>
              {length}/{X_POST_LIMIT}
              {length > X_POST_LIMIT ? " · needs X Premium" : ""}
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {open || retry ? (
          <Button type="button" size="sm" disabled={busy !== null || !text.trim()} onClick={() => void send()}>
            {busy === "send" ? spinner : <SendIcon aria-hidden="true" />}
            Send reply
          </Button>
        ) : null}
        {aiReady ? (
          <Button
            type="button"
            size="sm"
            variant={open ? "outline" : "default"}
            disabled={busy !== null}
            onClick={() => void runDraft()}
            title={draftCostUsd !== null ? `About ${formatUsd(draftCostUsd)} per draft` : undefined}
          >
            {busy === "draft" ? spinner : <SparklesIcon aria-hidden="true" />}
            {open ? "Redraft" : "Draft reply"}
          </Button>
        ) : null}
        {!open && !retry ? (
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => setOpen(true)}>
            <PencilIcon aria-hidden="true" />
            Write reply
          </Button>
        ) : null}
        {!handled ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => void toggleHandled(true)}>
            {busy === "handle" ? spinner : <CheckIcon aria-hidden="true" />}
            Mark handled
          </Button>
        ) : null}
        {open && !retry ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setOpen(false)
              setText("")
              setGenerationId(null)
              setAiNote(null)
              setError(null)
            }}
          >
            Cancel
          </Button>
        ) : null}
        {aiReady && draftCostUsd !== null && !open ? (
          <span className="text-xs text-muted-foreground">about {formatUsd(draftCostUsd)} per AI draft</span>
        ) : null}
        {!aiReady && !open ? (
          <Link href="/settings#ai" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Add an AI key to draft replies
          </Link>
        ) : null}
      </div>

      <p aria-live="polite" className="text-sm text-destructive empty:hidden">
        {error}
      </p>
    </div>
  )
}
