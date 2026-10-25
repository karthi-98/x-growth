"use client"

import { DatabaseIcon, LoaderCircleIcon, PowerIcon, RefreshCwIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { backupNowAction, checkForUpdateAction, setAutostartAction, type ActionResult } from "@/lib/runtime/actions"
import type { UpdateCheck } from "@/lib/runtime/releases"

// Owner: runtime workstream (docs/WORKSTREAMS.md). Buttons for Settings → App.

function Feedback({ result }: { result: ActionResult | null }) {
  if (!result) return null
  return (
    <span role="status" className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.ok ? result.message : result.error}
    </span>
  )
}

export function BackupNowButton() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => setResult(await backupNowAction()))}>
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <DatabaseIcon />}
        Back up now
      </Button>
      <Feedback result={result} />
    </div>
  )
}

export function AutostartToggle({ enabled }: { enabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<ActionResult | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        aria-pressed={enabled}
        onClick={() => startTransition(async () => setResult(await setAutostartAction(!enabled)))}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <PowerIcon />}
        {enabled ? "Don't start at login" : "Start at login"}
      </Button>
      {result && !result.ok ? <Feedback result={result} /> : null}
    </div>
  )
}

export function UpdateCheckButton() {
  const [pending, startTransition] = useTransition()
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => setCheck(await checkForUpdateAction()))}>
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
        Check for updates
      </Button>
      {check ? (
        <p role="status" className="text-xs text-muted-foreground">
          {check.error ? (
            <span className="text-destructive">Couldn&apos;t check: {check.error}</span>
          ) : check.available ? (
            <>
              Version {check.latest} is available.{" "}
              {check.url ? (
                <a className="underline underline-offset-2" href={check.url} target="_blank" rel="noreferrer">
                  What&apos;s new
                </a>
              ) : null}{" "}
              Ask Grok Bot to update X Growth, or run <code className="font-mono">xstats update</code>.
            </>
          ) : !check.latest ? (
            <>No release has been published yet.</>
          ) : (
            <>You have the latest version ({check.current}).</>
          )}
        </p>
      ) : null}
    </div>
  )
}
