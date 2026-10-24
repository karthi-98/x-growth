import { AlertTriangleIcon } from "lucide-react"
import Link from "next/link"
import { cn } from "cn"

import { healthCopy, toneDot, type HealthCopy } from "@/components/sync/health"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getSettings } from "@/lib/get-settings"
import { getSyncStatus } from "@/lib/sync/status"

const chipClass =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"

/**
 * Right side of the top bar: "Synced 2h ago · next 13:00", or a warning when
 * syncs are failing or stale. Async server component, rendered inside Suspense.
 */
export async function SyncStatus() {
  const settings = await getSettings()
  const now = new Date()
  let copy: HealthCopy
  try {
    copy = healthCopy(await getSyncStatus(now, settings), now)
  } catch {
    return (
      <Link href="/settings#sync" className={chipClass} title="Run `xstats doctor` to see why.">
        Sync status unavailable
      </Link>
    )
  }
  const warn = copy.tone === "warn" || copy.tone === "error"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings#sync" className={cn(chipClass, warn && "text-foreground")}>
          {warn ? (
            <AlertTriangleIcon
              className={cn("size-3.5", copy.tone === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400")}
              aria-hidden
            />
          ) : (
            <span className={cn("size-1.5 rounded-full", toneDot[copy.tone])} aria-hidden />
          )}
          <span>{copy.chip}</span>
          {copy.next ? <span className="hidden sm:inline">· next {copy.next}</span> : null}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-72 text-pretty">
        {copy.detail}
      </TooltipContent>
    </Tooltip>
  )
}
