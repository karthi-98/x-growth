"use client"

import { ClockIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { BestTimeHint as BestTimeHintData } from "@/lib/publish/best-time"
import { formatCompact } from "@/lib/format"

/** "Your originals do best on …" with one-click picks for the schedule field. */
export function BestTimeHint({ hint, onPick }: { hint: BestTimeHintData | null; onPick: (local: string) => void }) {
  if (!hint) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ClockIcon className="size-3.5" aria-hidden="true" />
        Best-time suggestions appear once you have a few original posts at the same hour.
      </p>
    )
  }
  const [best] = hint.slots
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ClockIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Your originals get the most impressions around <strong className="font-medium text-foreground">{best.label}</strong>{" "}
          (median {formatCompact(best.median)} over {best.posts} posts, last {hint.days} days).
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5 pl-5">
        {hint.slots.map((s) => (
          <Button
            key={`${s.weekday}-${s.hour}`}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onPick(s.next.local)}
            title={`Median ${formatCompact(s.median)} impressions over ${s.posts} posts`}
          >
            {s.label} · {formatCompact(s.median)}
          </Button>
        ))}
      </div>
    </div>
  )
}
