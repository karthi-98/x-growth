import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Header tag for a pay period that has not ended yet. */
export function InProgressTag() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" tabIndex={0} className="text-muted-foreground">
          <span aria-hidden="true" className="t-live-dot" />
          In progress
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        This pay period is still running; recent posts are still gaining impressions.
      </TooltipContent>
    </Tooltip>
  )
}
