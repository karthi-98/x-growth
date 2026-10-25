import { CheckIcon } from "lucide-react"
import Link from "next/link"

import { cn } from "cn"

import { setupSteps, stepHref, type SetupStepId } from "./steps"

// Owner: runtime workstream (docs/WORKSTREAMS.md).

export function SetupStepper({ current, complete }: { current: SetupStepId; complete: Partial<Record<SetupStepId, boolean>> }) {
  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {setupSteps.map((step, i) => {
          const isCurrent = step.id === current
          const isComplete = !isCurrent && complete[step.id]
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <Link
                href={stepHref(step.id)}
                aria-current={isCurrent ? "step" : undefined}
                className="group flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    isComplete && "border-primary/40 bg-primary/10 text-primary",
                    !isCurrent && !isComplete && "border-border text-muted-foreground group-hover:border-foreground/40"
                  )}
                >
                  {isComplete ? <CheckIcon className="size-3.5" aria-label="done" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-sm",
                    isCurrent ? "font-medium text-foreground" : "hidden text-muted-foreground sm:inline"
                  )}
                >
                  {step.title}
                </span>
              </Link>
              {i < setupSteps.length - 1 ? <span aria-hidden className="h-px min-w-2 flex-1 bg-border" /> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
