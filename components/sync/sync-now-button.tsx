"use client"

import { RefreshCwIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"

import { latestRunSince, syncNow, type RunResult, type SyncNowState } from "./actions"
import { FormMessage } from "./form-message"

const POLL_MS = 10_000
/** Approvals expire after about 10 minutes, so stop looking a bit later. */
const POLL_FOR_MS = 15 * 60_000

function describeRun(run: RunResult): { ok: boolean; message: string } {
  if (run.status === "failed") return { ok: false, message: `The import failed: ${run.error ?? "unknown error"}` }
  const posts = run.postsReceived ? ` ${run.postsReceived} posts, ${run.postsNew} new.` : ""
  return run.status === "partial"
    ? { ok: true, message: `Imported part of it.${posts} The next run continues.` }
    : { ok: true, message: `Imported.${posts}` }
}

/** POSTs the Grok Bot webhook (server side), then watches sync_runs for the import. */
export function SyncNowButton({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<SyncNowState>(null)
  const [run, setRun] = useState<RunResult | null>(null)
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    if (!state?.ok) return
    const since = state.at
    const started = Date.now()
    let active = true
    const timer = setInterval(async () => {
      if (Date.now() - started > POLL_FOR_MS) {
        clearInterval(timer)
        if (active) setWaiting(false)
        return
      }
      const found = await latestRunSince(since)
      if (!active || !found) return
      clearInterval(timer)
      setRun(found)
      setWaiting(false)
      router.refresh()
    }, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [state, router])

  const message = run
    ? describeRun(run)
    : !state?.ok || waiting
      ? state
      : { ok: true, message: "No import arrived. If the approval expired, the next reminder catches up." }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={!configured || pending || waiting}
          onClick={() =>
            startTransition(async () => {
              setRun(null)
              const res = await syncNow()
              setState(res)
              setWaiting(!!res?.ok)
            })
          }
        >
          <RefreshCwIcon className={pending || waiting ? "animate-spin" : undefined} />
          {waiting ? "Waiting for the import…" : "Sync now"}
        </Button>
        {configured ? null : (
          <span className="text-xs text-muted-foreground">Add the Grok Bot webhook below to turn this on.</span>
        )}
      </div>
      <FormMessage state={message} />
    </div>
  )
}
