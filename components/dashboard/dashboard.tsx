import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ActivityChart } from "@/components/dashboard/activity-chart"
import {
  ImpressionsChart,
  ImpressionsChartTypeSelect,
} from "@/components/dashboard/impressions-chart"
import { InProgressTag } from "@/components/dashboard/in-progress-tag"
import { StatCard } from "@/components/dashboard/stat-card"
import { TopPostsTable } from "@/components/dashboard/top-posts-table"
import { ViewAllPostsLink } from "@/components/dashboard/view-all-posts-link"
import { TypeSplit } from "@/components/dashboard/type-split"
import { formatNumber, formatPostDate, formatRangeLabel } from "@/lib/format"
import { connection } from "next/server"

import { istDateKey } from "@/lib/dates"
import { isRangeInProgress } from "@/lib/pay-periods"
import { getDashboardData, getDataBounds } from "@/lib/queries"
import { postsRangeParams } from "@/lib/range-links"
import { parseRange } from "@/lib/range"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function loadForParams(searchParams: SearchParams) {
  const params = await searchParams
  await connection() // "today" (IST) must be read per request
  const { from, to } = parseRange(params)
  return getDashboardData(from, to)
}

/**
 * /posts link for the current range. An exact preset match sends only
 * ?range=30d|3m|all so /posts highlights that segment; anything else sends
 * only from/to (IST, inclusive), which /posts shows as Custom. Top posts
 * include replies, so view=all, sorted by impressions.
 */
async function postsHref(range: { from: string; to: string }, today: string) {
  const bounds = await getDataBounds()
  const sp = new URLSearchParams({
    view: "all",
    sort: "impressions",
    ...postsRangeParams(range, today, bounds?.min ?? null),
  })
  return `/posts?${sp}`
}

export async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const data = await loadForParams(searchParams)
  const { range } = data
  const label = formatRangeLabel(range.from, range.to)
  const hasData = data.topPosts.length > 0
  const today = istDateKey()
  const inProgress = isRangeInProgress(range, today)

  const postCount = data.metrics.find((m) => m.key === "posts")?.current ?? data.topPosts.length
  const viewAllHref = await postsHref(range, today)

  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No posts between {label}</CardTitle>
          <CardDescription>
            Pick another range, import posts with bun run db:import &lt;file&gt;,
            or load dummy data with bun run db:seed.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const typeTitle = data.byType.some((t) => t.type === "reply")
    ? "Impressions by type"
    : "Originals vs quotes"

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-label="Summary"
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      >
        {data.metrics.map((metric, i) => (
          <StatCard
            key={metric.key}
            metric={metric}
            index={i}
            inProgress={inProgress}
            className={i === data.metrics.length - 1 ? "col-span-2 sm:col-span-1" : undefined}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="t-rise lg:col-span-2" style={{ "--i": 5 } as React.CSSProperties}>
          <CardHeader>
            <CardTitle>Impressions</CardTitle>
            <CardDescription>
              Daily, by post date, {label}
            </CardDescription>
            <CardAction><ImpressionsChartTypeSelect /></CardAction>
          </CardHeader>
          <CardContent>
            <ImpressionsChart data={data.series} />
          </CardContent>
        </Card>
        <Card className="t-rise" style={{ "--i": 6 } as React.CSSProperties}>
          <CardHeader>
            <CardTitle>{typeTitle}</CardTitle>
            <CardDescription>Share of impressions, {label}</CardDescription>
          </CardHeader>
          <CardContent>
            <TypeSplit data={data.byType} />
          </CardContent>
        </Card>
      </section>

      <ActivityChart from={range.from} to={range.to} />

      <Card className="t-rise" style={{ "--i": 8 } as React.CSSProperties}>
        <CardHeader>
          <CardTitle>Top posts</CardTitle>
          <CardDescription>
            {postCount > data.topPosts.length
              ? `Top ${data.topPosts.length} of ${formatNumber(postCount)} posts by impressions, ${label}`
              : `All ${formatNumber(postCount)} ${postCount === 1 ? "post" : "posts"} by impressions, ${label}`}
          </CardDescription>
          <CardAction>
            <ViewAllPostsLink href={viewAllHref} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <TopPostsTable posts={data.topPosts} />
        </CardContent>
      </Card>
    </div>
  )
}

export async function DataStatus({ searchParams }: { searchParams: SearchParams }) {
  const { isSample, range, days, updatedAt } = await loadForParams(searchParams)
  const label = formatRangeLabel(range.from, range.to)
  if (isSample) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {label}
        <Badge variant="outline">Sample data</Badge>
      </span>
    )
  }
  const inProgress = isRangeInProgress(range, istDateKey())
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
      Posts, replies &amp; quotes · reposts excluded · {days === 1 ? "1 day" : `${days} days`}
      {updatedAt ? ` · updated ${formatPostDate(updatedAt)} IST` : null}
      </span>
      {inProgress ? <InProgressTag /> : null}
    </div>
  )
}
