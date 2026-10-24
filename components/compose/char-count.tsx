import { cn } from "cn"

import { MAX_POST_LENGTH } from "@/lib/x/text"

/** X-style progress ring plus the remaining count once it gets close. */
export function CharCount({ length }: { length: number }) {
  const remaining = MAX_POST_LENGTH - length
  const ratio = Math.min(length / MAX_POST_LENGTH, 1)
  const r = 9
  const c = 2 * Math.PI * r
  const tone = remaining < 0 ? "text-destructive" : remaining <= 20 ? "text-amber-600 dark:text-amber-400" : "text-primary"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tabular-nums" aria-live="polite">
      <svg viewBox="0 0 24 24" className={cn("size-5 -rotate-90", tone)} aria-hidden="true">
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn(remaining <= 20 ? tone : "text-muted-foreground")}>
        {remaining <= 20 ? remaining : `${length}/${MAX_POST_LENGTH}`}
        <span className="sr-only"> characters {remaining < 0 ? "over the limit" : "left"}</span>
      </span>
    </span>
  )
}
