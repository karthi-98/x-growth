"use client"

import { ArrowUpRightIcon, XIcon, type LucideIcon } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parsePostRef } from "@/lib/x/text"

/** Paste an X post URL to reply to or quote it. */
export function PostRefField({
  label,
  icon: Icon,
  value,
  onChange,
  onRemove,
  note,
}: {
  label: string
  icon: LucideIcon
  value: string
  onChange: (value: string) => void
  onRemove: () => void
  note: string
}) {
  const id = useId()
  const postId = value.trim() ? parsePostRef(value) : null
  const invalid = !!value.trim() && !postId
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}>
          <XIcon />
        </Button>
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://x.com/user/status/1234567890"
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-note`}
        inputMode="url"
        autoComplete="off"
      />
      <p id={`${id}-note`} className="text-xs text-muted-foreground">
        {invalid ? (
          <span className="text-destructive">That isn&apos;t an X post link. Paste a link like x.com/user/status/123.</span>
        ) : postId ? (
          <>
            Post {postId}{" "}
            <a
              href={`https://x.com/i/status/${postId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
            >
              open <ArrowUpRightIcon className="size-3" aria-hidden="true" />
            </a>
            . {note}
          </>
        ) : (
          note
        )}
      </p>
    </div>
  )
}
