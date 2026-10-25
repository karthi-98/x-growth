"use client"

import {
  CheckIcon,
  KeyRoundIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  ScissorsIcon,
  SmileIcon,
  SparklesIcon,
  WandSparklesIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getAiAssistStatus,
  markAiAccepted,
  runAiAssist,
  type AiAssistStatus,
  type AssistResult,
} from "@/lib/ai/actions"
import { formatUsd } from "@/lib/ai/models"
import { ASSIST_LABELS, assistModes, needsDraft, type AssistMode } from "@/lib/ai/prompts"
import { X_POST_LIMIT, xLength } from "@/lib/ai/text"

export type AiAssistProps = {
  /** Current editor text (one part of a post or thread). */
  text: string
  /** Replace the editor text with an AI suggestion the user accepted. */
  onApply: (next: string) => void
}

const ICONS: Record<AssistMode, LucideIcon> = {
  rewrite: WandSparklesIcon,
  shorter: ScissorsIcon,
  hook: ZapIcon,
  casual: SmileIcon,
  ideas: LightbulbIcon,
}

type Result = { mode: AssistMode; outcome: AssistResult }

/** AI tools shown next to the compose editor: rewrite, shorter, stronger hook, ideas. */
export function AiAssist({ text, onApply }: AiAssistProps) {
  const [status, setStatus] = useState<AiAssistStatus | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [running, setRunning] = useState<AssistMode | null>(null)
  const [applied, setApplied] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    getAiAssistStatus()
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null))
    return () => {
      live = false
    }
  }, [])

  const run = async (mode: AssistMode) => {
    setRunning(mode)
    setApplied(null)
    try {
      setResult({ mode, outcome: await runAiAssist({ mode, text }) })
    } catch {
      setResult({ mode, outcome: { ok: false, error: "Couldn't reach the app server. Is it still running?" } })
    } finally {
      setRunning(null)
    }
  }

  const apply = (suggestion: string, index: number, generationId: string) => {
    onApply(suggestion)
    setApplied(index)
    void markAiAccepted(generationId)
  }

  if (status && !status.hasKey) return <NoKey />

  const hasDraft = text.trim().length > 0
  const busy = running !== null
  const outcome = result?.outcome
  const resultMode = result?.mode

  return (
    <section aria-label="AI assist" className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <SparklesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          AI assist
        </h2>
        <p className="text-xs text-muted-foreground">
          {status ? (
            <>
              {status.model}
              {status.estCostUsd !== null ? <> &middot; about {formatUsd(status.estCostUsd)} per click</> : null}
            </>
          ) : (
            <span className="inline-block h-3 w-32 animate-pulse rounded bg-muted align-middle" />
          )}
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="AI actions">
        {assistModes.map((mode) => {
          const Icon = ICONS[mode]
          const disabled = busy || !status || (needsDraft(mode) && !hasDraft)
          return (
            <Button
              key={mode}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void run(mode)}
              title={needsDraft(mode) && !hasDraft ? "Write something first" : undefined}
            >
              {running === mode ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <Icon aria-hidden="true" />
              )}
              {ASSIST_LABELS[mode]}
            </Button>
          )
        })}
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {busy ? (
          <>
            <span className="sr-only">Writing suggestions…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </>
        ) : outcome && !outcome.ok ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {outcome.error}{" "}
            {outcome.code === "bad-key" || outcome.code === "no-key" || outcome.code === "bad-model" ? (
              <Link href="/settings#ai" className="font-medium underline underline-offset-4">
                Open Settings → AI
              </Link>
            ) : null}
          </p>
        ) : outcome?.ok ? (
          <>
            <ol className="flex flex-col gap-2">
              {outcome.suggestions.map((s, i) => {
                const length = xLength(s)
                return (
                  <li
                    key={`${resultMode}-${i}`}
                    className="t-rise flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-2.5"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{s}</p>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className={length > X_POST_LIMIT ? "text-destructive" : "tabular-nums"}>
                        {length}/{X_POST_LIMIT}
                      </span>
                      <Button
                        type="button"
                        size="xs"
                        variant={applied === i ? "secondary" : "default"}
                        onClick={() => apply(s, i, outcome.generationId)}
                      >
                        {applied === i ? <CheckIcon aria-hidden="true" /> : null}
                        {applied === i ? "Applied" : "Apply"}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ol>
            <p className="text-xs text-muted-foreground">
              {resultMode ? ASSIST_LABELS[resultMode] : "Done"} with {outcome.model} &middot; cost {formatUsd(outcome.estCostUsd)}.
              Suggestions are drafts: nothing is posted until you post it.
            </p>
          </>
        ) : null}
      </div>
    </section>
  )
}

function NoKey() {
  return (
    <section
      aria-label="AI assist"
      className="flex flex-col items-start gap-2 rounded-xl p-4 text-sm ring-1 ring-foreground/10"
    >
      <h2 className="flex items-center gap-1.5 font-medium">
        <SparklesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        AI assist
      </h2>
      <p className="text-muted-foreground">
        Add your own AI key (xAI, OpenAI, Anthropic or OpenRouter) to rewrite drafts, sharpen hooks and get post
        ideas in your voice.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/settings#ai">
          <KeyRoundIcon aria-hidden="true" />
          Add an AI key in Settings
        </Link>
      </Button>
    </section>
  )
}
