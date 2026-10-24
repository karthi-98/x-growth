import { DeltaBadge } from "@/components/dashboard/delta-badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCompact, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MetricSummary } from "@/lib/queries"

const labels: Record<MetricSummary["key"], string> = {
  impressions: "Impressions",
  likes: "Likes",
  replies: "Replies",
  bookmarks: "Bookmarks",
  posts: "Posts",
}

export function StatCard({
  metric,
  index,
  className,
  inProgress = false,
}: {
  metric: MetricSummary
  index: number
  className?: string
  /** The selected period isn't over yet; the change is provisional. */
  inProgress?: boolean
}) {
  const { change } = metric

  return (
    <Card
      className={cn("t-rise", className)}
      style={{ "--i": index } as React.CSSProperties}
    >
      <CardHeader>
        <CardDescription>{labels[metric.key]}</CardDescription>
        <CardTitle
          className="text-2xl font-semibold tabular-nums tracking-tight"
          title={formatNumber(metric.current)}
        >
          {formatCompact(metric.current)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-5 flex-wrap items-center justify-between gap-2">
        {metric.previous === null ? (
          <span className="text-xs text-muted-foreground">
            No prior period yet
          </span>
        ) : (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              vs {formatCompact(metric.previous)}
            </span>
            {change !== null ? (
              <DeltaBadge change={change} inProgress={inProgress} />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
