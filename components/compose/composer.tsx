"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  PlusIcon,
  QuoteIcon,
  ReplyIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { cn } from "cn"

import { composeAction } from "@/app/compose/actions"
import { AiAssist } from "@/components/compose/ai-assist"
import { BestTimeHint } from "@/components/compose/best-time-hint"
import { CharCount } from "@/components/compose/char-count"
import { PostRefField } from "@/components/compose/post-ref-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { BestTimeHint as BestTimeHintData } from "@/lib/publish/best-time"
import type { ComposeIntent } from "@/lib/publish/drafts"
import {
  MAX_POST_LENGTH,
  containsUrl,
  formatUsd,
  parsePostRef,
  partCostUsd,
  partsCostUsd,
  weightedLength,
  type XPostPrices,
} from "@/lib/x/text"

export type ComposerInitial = {
  draftId?: string
  parts: string[]
  replyTo: string
  quote: string
  scheduleLocal: string
}

export type ComposerProps = {
  initial: ComposerInitial
  /** Next full hour in the user's timezone, for a fresh schedule picker. */
  defaultScheduleLocal: string
  /** Now in the user's timezone (datetime-local `min`). */
  minScheduleLocal: string
  timeZone: string
  prices: XPostPrices
  hint: BestTimeHintData | null
  hasKeys: boolean
  dryRun: boolean
}

type Part = { key: string; text: string }

let keySeq = 0
const newKey = () => `part-${++keySeq}`

const TEXTAREA =
  "field-sizing-content min-h-24 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-base leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"

export function Composer({
  initial,
  defaultScheduleLocal,
  minScheduleLocal,
  timeZone,
  prices,
  hint,
  hasKeys,
  dryRun,
}: ComposerProps) {
  const router = useRouter()
  const [draftId, setDraftId] = useState(initial.draftId)
  const [parts, setParts] = useState<Part[]>(() =>
    (initial.parts.length ? initial.parts : [""]).map((text) => ({ key: newKey(), text }))
  )
  const [replyTo, setReplyTo] = useState(initial.replyTo)
  const [quote, setQuote] = useState(initial.quote)
  const [showReply, setShowReply] = useState(!!initial.replyTo)
  const [showQuote, setShowQuote] = useState(!!initial.quote)
  const [scheduleLocal, setScheduleLocal] = useState(initial.scheduleLocal || defaultScheduleLocal)
  const [confirmNow, setConfirmNow] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; queueLink?: boolean } | null>(null)
  const [pending, startTransition] = useTransition()
  const [pendingIntent, setPendingIntent] = useState<ComposeIntent | null>(null)

  const texts = parts.map((p) => p.text)
  const lengths = texts.map(weightedLength)
  const total = partsCostUsd(texts, prices)
  const links = texts.filter(containsUrl).length
  const isThread = parts.length > 1
  const over = lengths.some((l) => l > MAX_POST_LENGTH)
  const empty = texts.some((t) => !t.trim())
  const refsBad = (showReply && !!replyTo.trim() && !parsePostRef(replyTo)) || (showQuote && !!quote.trim() && !parsePostRef(quote))
  const cannotSend = over || empty || refsBad
  const postsLabel = isThread ? `${parts.length} posts` : "1 post"

  const update = (key: string, text: string) => {
    setParts((ps) => ps.map((p) => (p.key === key ? { ...p, text } : p)))
    setConfirmNow(false)
  }
  const move = (index: number, by: -1 | 1) =>
    setParts((ps) => {
      const next = [...ps]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      return next
    })
  const remove = (key: string) => setParts((ps) => (ps.length > 1 ? ps.filter((p) => p.key !== key) : ps))
  const add = () => setParts((ps) => [...ps, { key: newKey(), text: "" }])

  const reset = () => {
    setDraftId(undefined)
    setParts([{ key: newKey(), text: "" }])
    setReplyTo("")
    setQuote("")
    setShowReply(false)
    setShowQuote(false)
    setScheduleLocal(defaultScheduleLocal)
    if (initial.draftId) router.replace("/compose")
  }

  const submit = (intent: ComposeIntent) => {
    setConfirmNow(false)
    setResult(null)
    setPendingIntent(intent)
    startTransition(async () => {
      const res = await composeAction({
        draftId,
        parts: texts,
        replyTo: showReply ? replyTo : "",
        quote: showQuote ? quote : "",
        intent,
        scheduleLocal: intent === "schedule" ? scheduleLocal : undefined,
      })
      setPendingIntent(null)
      if (!res.ok) {
        // Saved but not sent: keep editing that draft instead of creating another.
        if (res.draftId) setDraftId(res.draftId)
        setResult({ ok: false, message: res.error, queueLink: intent === "now" })
        return
      }
      if (intent === "draft") {
        setDraftId(res.draftId)
        setResult({ ok: true, message: res.message, queueLink: true })
        return
      }
      reset()
      setResult({ ok: true, message: res.message, queueLink: true })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {(dryRun || !hasKeys) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            dryRun
              ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          )}
        >
          {dryRun ? (
            <>
              <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Dry run is on (XGROWTH_X_DRY_RUN=1): nothing is sent to X and posts get fake ids.</span>
            </>
          ) : (
            <>
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Add your X API keys in{" "}
                <Link href="/settings#x-keys" className="font-medium underline underline-offset-4">
                  Settings
                </Link>{" "}
                before posting. You can still write and schedule.
              </span>
            </>
          )}
        </div>
      )}

      <section aria-label={isThread ? "Thread" : "Post"} className="flex flex-col gap-4">
        {(showReply || showQuote) && (
          <div className="flex flex-col gap-3">
            {showReply && (
              <PostRefField
                label="Replying to"
                icon={ReplyIcon}
                value={replyTo}
                onChange={setReplyTo}
                onRemove={() => {
                  setShowReply(false)
                  setReplyTo("")
                }}
                note="On X's pay-per-use API, a reply only goes through when that post's author mentioned or quoted you."
              />
            )}
            {showQuote && (
              <PostRefField
                label="Quoting"
                icon={QuoteIcon}
                value={quote}
                onChange={setQuote}
                onRemove={() => {
                  setShowQuote(false)
                  setQuote("")
                }}
                note="X only accepts quote posts through the API on Enterprise plans, so on pay-per-use this is refused. Pasting the post's link into your text works instead, at the $0.20 link price."
              />
            )}
          </div>
        )}

        <ol className="flex flex-col">
          {parts.map((part, i) => {
            const length = lengths[i]
            const hasLink = containsUrl(part.text)
            return (
              <li key={part.key} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Thread rail */}
                <div className="flex flex-col items-center pt-2" aria-hidden="true">
                  <span className="grid size-6 place-items-center rounded-full bg-muted text-[0.7rem] font-medium tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  {i < parts.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <label htmlFor={`part-${part.key}`} className="sr-only">
                    {isThread ? `Post ${i + 1} of ${parts.length}` : "Post text"}
                  </label>
                  <textarea
                    id={`part-${part.key}`}
                    value={part.text}
                    onChange={(e) => update(part.key, e.target.value)}
                    placeholder={i === 0 ? "What's happening?" : "Add another post"}
                    aria-invalid={length > MAX_POST_LENGTH || undefined}
                    className={TEXTAREA}
                  />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <CharCount length={length} />
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        hasLink ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                      )}
                      title={hasLink ? "X charges more for posts that contain a link" : "X's price per post"}
                    >
                      {formatUsd(partCostUsd(part.text, prices))}
                      {hasLink && " · link"}
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <AiAssist text={part.text} onApply={(next) => update(part.key, next)} />
                      {isThread && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            aria-label={`Move post ${i + 1} up`}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => move(i, 1)}
                            disabled={i === parts.length - 1}
                            aria-label={`Move post ${i + 1} down`}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => remove(part.key)}
                            aria-label={`Remove post ${i + 1}`}
                          >
                            <Trash2Icon />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        <div className="flex flex-wrap gap-2 pl-9">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon /> Add to thread
          </Button>
          {!showReply && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowReply(true)}>
              <ReplyIcon /> Reply to a post
            </Button>
          )}
          {!showQuote && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowQuote(true)}>
              <QuoteIcon /> Quote a post
            </Button>
          )}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Publish</CardTitle>
          <CardDescription>
            {postsLabel} · estimated {formatUsd(total)} on X&apos;s pay-per-use pricing
            {draftId && " · editing a saved draft"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {links > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {!isThread
                  ? "This post contains a link"
                  : links === 1
                    ? "One of these posts contains a link"
                    : `${links} of these posts contain links`}
                , so X charges {formatUsd(prices.postWithUrl)} instead of {formatUsd(prices.post)} for{" "}
                {links === 1 ? "it" : "each of them"}. Consider putting the link in a reply.
              </span>
            </p>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="schedule-at" className="text-sm font-medium">
              Schedule for
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="schedule-at"
                type="datetime-local"
                value={scheduleLocal}
                min={minScheduleLocal}
                onChange={(e) => setScheduleLocal(e.target.value)}
                className="w-auto"
              />
              <span className="text-xs text-muted-foreground">Times are in {timeZone}</span>
            </div>
            <BestTimeHint hint={hint} onPick={setScheduleLocal} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {confirmNow ? (
              <>
                <span className="text-sm">
                  Post {postsLabel} to X now for about {formatUsd(total)}?
                </span>
                <Button type="button" onClick={() => submit("now")} disabled={pending}>
                  <SendIcon /> Yes, post now
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmNow(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button type="button" onClick={() => setConfirmNow(true)} disabled={pending || cannotSend}>
                  {pendingIntent === "now" ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />} Post now
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => submit("schedule")}
                  disabled={pending || cannotSend || !scheduleLocal}
                >
                  {pendingIntent === "schedule" ? <LoaderCircleIcon className="animate-spin" /> : <CalendarClockIcon />}{" "}
                  Schedule
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => submit("draft")}
                  disabled={pending || texts.every((t) => !t.trim())}
                >
                  {pendingIntent === "draft" ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />} Save draft
                </Button>
              </>
            )}
          </div>
          {cannotSend && !empty && (
            <p className="text-sm text-destructive">
              {over ? `Shorten the highlighted post to ${MAX_POST_LENGTH} characters.` : "Fix the post link above."}
            </p>
          )}

          {result && (
            <p
              role="status"
              className={cn("text-sm", result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}
            >
              {result.message}
              {result.queueLink && (
                <>
                  {" "}
                  <Link href="/queue" className="font-medium underline underline-offset-4">
                    Open the queue
                  </Link>
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
