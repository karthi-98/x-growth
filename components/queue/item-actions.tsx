"use client"

import {
  CalendarClockIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  PencilIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useState, useTransition } from "react"

import {
  deleteAction,
  markPostedAction,
  postNowAction,
  rescheduleAction,
  unscheduleAction,
  type QueueActionResult,
} from "@/app/queue/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type QueueAction = "postNow" | "retry" | "reschedule" | "discard" | "unschedule" | "markPosted" | "edit" | "delete"

type Mode = null | "postNow" | "retry" | "delete" | "reschedule"

/** Buttons for one queue item. Anything that sends to X or deletes asks once more. */
export function ItemActions({
  id,
  actions,
  costLabel,
  defaultLocal,
  minLocal,
  timeZone,
  deleteNote = "Delete this from the app?",
}: {
  id: string
  actions: QueueAction[]
  /** "1 post · $0.015" for the confirm prompt. */
  costLabel: string
  defaultLocal: string
  minLocal: string
  timeZone: string
  deleteNote?: string
}) {
  const [mode, setMode] = useState<Mode>(null)
  const [local, setLocal] = useState(defaultLocal)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const has = (a: QueueAction) => actions.includes(a)

  const run = (fn: () => Promise<QueueActionResult>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (res.ok) setMode(null)
      else setError(res.error ?? "Something went wrong.")
    })
  }
  const spinner = pending ? <LoaderCircleIcon className="animate-spin" /> : null

  let body: React.ReactNode
  if (mode === "postNow" || mode === "retry") {
    body = (
      <>
        <span className="text-sm">
          {mode === "retry"
            ? `Only retry if it isn't on your profile already. Send ${costLabel} now?`
            : `Send ${costLabel} to X now?`}
        </span>
        <Button size="sm" onClick={() => run(() => postNowAction(id))} disabled={pending}>
          {spinner ?? <SendIcon />} Yes, send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
          Cancel
        </Button>
      </>
    )
  } else if (mode === "delete") {
    body = (
      <>
        <span className="text-sm">{deleteNote}</span>
        <Button size="sm" variant="destructive" onClick={() => run(() => deleteAction(id))} disabled={pending}>
          {spinner ?? <Trash2Icon />} Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
          Cancel
        </Button>
      </>
    )
  } else if (mode === "reschedule") {
    body = (
      <>
        <label className="sr-only" htmlFor={`reschedule-${id}`}>
          New time ({timeZone})
        </label>
        <Input
          id={`reschedule-${id}`}
          type="datetime-local"
          value={local}
          min={minLocal}
          onChange={(e) => setLocal(e.target.value)}
          className="h-7 w-auto"
        />
        <Button size="sm" onClick={() => run(() => rescheduleAction(id, local))} disabled={pending || !local}>
          {spinner ?? <CalendarClockIcon />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">{timeZone}</span>
      </>
    )
  } else {
    body = (
      <>
        {has("postNow") && (
          <Button size="sm" onClick={() => setMode("postNow")}>
            <SendIcon /> Post now
          </Button>
        )}
        {has("retry") && (
          <Button size="sm" variant="secondary" onClick={() => setMode("retry")}>
            <RotateCcwIcon /> Retry
          </Button>
        )}
        {has("markPosted") && (
          <Button size="sm" variant="outline" onClick={() => run(() => markPostedAction(id))} disabled={pending}>
            {spinner ?? <CircleCheckIcon />} Mark as posted
          </Button>
        )}
        {has("reschedule") && (
          <Button size="sm" variant="outline" onClick={() => setMode("reschedule")}>
            <CalendarClockIcon /> Reschedule
          </Button>
        )}
        {has("edit") && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/compose?draft=${encodeURIComponent(id)}`}>
              <PencilIcon /> Edit
            </Link>
          </Button>
        )}
        {(has("discard") || has("unschedule")) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(() => unscheduleAction(id))}
            disabled={pending}
            title="Unschedule it and keep the text in Drafts"
          >
            {spinner ?? <XIcon />} {has("discard") ? "Discard" : "Unschedule"}
          </Button>
        )}
        {has("delete") && (
          <Button size="sm" variant="ghost" onClick={() => setMode("delete")} aria-label="Delete">
            <Trash2Icon />
          </Button>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">{body}</div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
