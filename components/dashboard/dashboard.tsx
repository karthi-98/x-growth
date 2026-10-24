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
import { FollowerGrowth } from "@/components/dashboard/follower-growth"
import {
  ImpressionsChart,
  ImpressionsChartTypeSelect,
} from "@/components/dashboard/impressions-chart"
import { InProgressTag } from "@/components/dashboard/in-progress-tag"
import { StatCard } from "@/components/dashboard/stat-card"
import { TopPostsTable } from "@/components/dashboard/top-posts-table"
import { ViewAllPostsLink } from "@/components/dashboard/view-all-posts-link"
import { TypeSplit } from "@/components/dashboard/type-split"
import {
  formatDayKey,
  formatNumber,
  formatPostDate,
  formatRangeLabel,
  formatTimeZone,
  timeZoneAbbr,
} from "@/lib/format"

import { dateKeyIn } from "@/lib/dates"
import { getSettings } from "@/lib/get-settings"
import { getImpressionsGained } from "@/lib/insights/growth-query"
import { MIN_TRACKED_DAYS } from "@/lib/insights/growth"
import { isRangeInProgress } from "@/lib/pay-periods"
import { getDashboardData, getDataBounds } from "@/lib/queries"
import { postsRangeParams } from "@/lib/range-links"
import { parseRange } from "@/lib/range"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function loadForParams(searchParams: SearchParams) {
  const [params, settings] = await Promise.all([searchParams, getSettings()])
  // getSettings() awaits connection(), so "today" is read per request.
  const today = dateKeyIn(new Date(), settings.timeZone)
  const { from, to } = parseRange(params, today)
  const data = await getDashboardData(from, to, settings.timeZone)
  return { data, settings, today }
}

/**
 * /posts link for the current range. An exact preset match sends only
 * ?range=30d|3m|all so /posts highlights that segment; anything else sends
 * only from/to (local dates, inclusive), which /posts shows as Custom. Top
 * posts include replies, so view=all, sorted by impressions.
 */
async function postsHref(range: { from: string; to: string }, today: string, timeZone: string) {
  const bounds = await getDataBounds(timeZone)
  const sp = new URLSearchParams({
    view: "all",
    sort: "impressions",
    ...postsRangeParams(range, today, bounds?.min ?? null),
  })
  return `/posts?${sp}`
}

/**
 * Impressions per day: gained per day from metric snapshots once there are
 * enough of them, else each post's lifetime total on the day it was posted.
 */
async function ImpressionsCard({
  range,
  postDateSeries,
  timeZone,
  today,
}: {
  range: { from: string; to: string }
  postDateSeries: { date: string; impressions: number }[]
  timeZone: string
  today: string
}) {
  const label = formatRangeLabel(range.from, range.to)
  const gained = await getImpressionsGained(range.from, range.to, timeZone, today)

  return (
    <Card className="t-rise lg:col-span-2" style={{ "--i": 5 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>{gained ? "Impressions gained" : "Impressions"}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {gained ? (
            <>
              <span>Per day, from synced metric snapshots, {label}</span>
              {gained.trackedFrom > range.from ? (
                <Badge variant="outline">Tracked from {formatDayKey(gained.trackedFrom)}</Badge>
              ) : null}
            </>
          ) : (
            <>
              <span>Lifetime totals by post date, {label}</span>
              <Badge variant="outline">
                Per-day gains after {MIN_TRACKED_DAYS} days of syncs
              </Badge>
            </>
          )}
        </CardDescription>
        <CardAction><ImpressionsChartTypeSelect /></CardAction>
      </CardHeader>
      <CardContent>
        <ImpressionsChart
          data={gained ? gained.series : postDateSeries}
          seriesLabel={gained ? "Gained" : "Impressions"}
        />
      </CardContent>
    </Card>
  )
}

export async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { data, settings, today } = await loadForParams(searchParams)
  const { range } = data
  const { timeZone } = settings
  const label = formatRangeLabel(range.from, range.to)
  const hasData = data.topPosts.length > 0
  const inProgress = isRangeInProgress(range, today, settings.payPeriod)

  const postCount = data.metrics.find((m) => m.key === "posts")?.current ?? data.topPosts.length
  const viewAllHref = await postsHref(range, today, timeZone)

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
        <ImpressionsCard
          range={range}
          postDateSeries={data.series}
          timeZone={timeZone}
          today={today}
        />
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

      <FollowerGrowth from={range.from} to={range.to} timeZone={timeZone} userId={settings.userId} />

      <ActivityChart from={range.from} to={range.to} timeZone={timeZone} />

      <Card className="t-rise" style={{ "--i": 9 } as React.CSSProperties}>
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
          <TopPostsTable posts={data.topPosts} timeZone={timeZone} />
        </CardContent>
      </Card>
    </div>
  )
}

export async function DataStatus({ searchParams }: { searchParams: SearchParams }) {
  const { data, settings, today } = await loadForParams(searchParams)
  const { isSample, range, days, updatedAt } = data
  const label = formatRangeLabel(range.from, range.to)
  if (isSample) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {label}
        <Badge variant="outline">Sample data</Badge>
      </span>
    )
  }
  const inProgress = isRangeInProgress(range, today, settings.payPeriod)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>
      Posts, replies &amp; quotes · reposts excluded · {days === 1 ? "1 day" : `${days} days`}
      {updatedAt
        ? ` · updated ${formatPostDate(updatedAt, settings.timeZone)} ${timeZoneAbbr(settings.timeZone, new Date(updatedAt))}`
        : null}
      </span>
      {inProgress ? <InProgressTag /> : null}
    </div>
  )
}

/** Footer note naming the timezone dates are shown in. */
export async function DashboardFootnote() {
  const { timeZone } = await getSettings()
  return (
    <>
      Post metrics from the X API (public metrics). Includes your posts, replies and quotes; reposts
      excluded. Totals sum each post&apos;s lifetime numbers on the day it was posted; impressions
      gained per day come from synced metric snapshots. Dates in {formatTimeZone(timeZone)}.
    </>
  )
}
