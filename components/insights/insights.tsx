import { ArrowUpRightIcon } from "lucide-react"
import Link from "next/link"

import { PostTypeBadge } from "@/components/dashboard/post-type-badge"
import { BestTimeHeatmap } from "@/components/insights/best-time-heatmap"
import { MedianBarChart } from "@/components/insights/median-bar-chart"
import { WeeklyPostsChart } from "@/components/insights/weekly-posts-chart"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCompact, formatDayKey, formatNumber, formatPostDate, formatRangeLabel, formatRate, timeZoneAbbr } from "@/lib/format"
import { getSettings } from "@/lib/get-settings"
import { formatHourSpan } from "@/lib/insights/heatmap"
import {
  getInsights,
  INSIGHTS_RANGE_LABELS,
  insightsRanges,
  MATURE_AFTER_HOURS,
  parseInsightsRange,
  type InsightsData,
  type InsightsRange,
} from "@/lib/insights/insights-query"
import { LENGTH_MIN_POSTS } from "@/lib/insights/performance"
import { WEEKDAYS, WEEKDAYS_LONG } from "@/lib/insights/zoned"
import { POST_TYPE_COLORS, POST_TYPE_META } from "@/lib/post-types"
import { postHref } from "@/lib/posts-params"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`
const dash = "–"

/** 30 days / 90 days / All time, as links (?range=). */
export async function InsightsRangeTabs({ searchParams }: { searchParams: SearchParams }) {
  const current = parseInsightsRange((await searchParams).range)
  return (
    <nav aria-label="Time range" className="flex w-full rounded-lg bg-muted p-[3px] sm:w-auto">
      {insightsRanges.map((r: InsightsRange) => {
        const active = r === current
        return (
          <Button
            key={r}
            asChild
            size="sm"
            variant="ghost"
            className={
              active
                ? "flex-1 bg-background text-foreground shadow-sm ring-1 ring-foreground/5 hover:bg-background sm:flex-none dark:bg-input/60"
                : "flex-1 text-muted-foreground hover:bg-transparent hover:text-foreground sm:flex-none"
            }
          >
            <Link href={`/insights?range=${r}`} aria-current={active ? "page" : undefined} scroll={false}>
              {INSIGHTS_RANGE_LABELS[r]}
            </Link>
          </Button>
        )
      })}
    </nav>
  )
}

export function InsightsRangeTabsFallback() {
  return <div className="h-[34px] w-full rounded-lg bg-muted sm:w-64" />
}

function BestTime({ data, zone, label }: { data: InsightsData; zone: string; label: string }) {
  const { heatmap } = data
  const bestDay = heatmap.byWeekday
    .filter((d) => d.median !== null)
    .sort((a, b) => b.median! - a.median!)[0]
  const bestHour = heatmap.byHour
    .filter((h) => h.median !== null)
    .sort((a, b) => b.median! - a.median!)[0]

  return (
    <Card className="t-rise" style={{ "--i": 0 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>Best time to post</CardTitle>
        <CardDescription>
          Median impressions of originals and quotes by the weekday and hour they went out ({zone}),{" "}
          {label}. Scored from {plural(heatmap.posts, "post", "posts")}; posts from the last{" "}
          {MATURE_AFTER_HOURS} hours are left out while they&apos;re still gaining.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {heatmap.best.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Strongest hours</h3>
            <ol className="flex flex-wrap gap-2">
              {heatmap.best.map((c, i) => (
                <li
                  key={`${c.weekday}-${c.hour}`}
                  className="flex items-baseline gap-2 rounded-lg border px-3 py-1.5 text-sm"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="font-medium">
                    {WEEKDAYS[c.weekday]} {formatHourSpan(c.hour)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatCompact(Math.round(c.median!))} median · {plural(c.posts, "post", "posts")}
                  </span>
                </li>
              ))}
            </ol>
            {bestDay && bestHour ? (
              <p className="text-xs text-muted-foreground">
                Best day overall: <span className="text-foreground">{WEEKDAYS_LONG[bestDay.weekday]}</span> (
                {formatCompact(Math.round(bestDay.median!))} median). Best hour on any day:{" "}
                <span className="text-foreground">{formatHourSpan(bestHour.hour)}</span> (
                {formatCompact(Math.round(bestHour.median!))} median).
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hour has {heatmap.minPosts} or more posts yet in this range. Pick a longer range.
          </p>
        )}
        <BestTimeHeatmap heatmap={heatmap} />
      </CardContent>
    </Card>
  )
}

function PerformanceTable({
  rows,
  first,
}: {
  rows: { key: string; name: React.ReactNode; posts: number; medianImpressions: number | null; medianRate: number | null; note?: string }[]
  first: string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{first}</TableHead>
          <TableHead className="text-right">Posts</TableHead>
          <TableHead className="text-right">Median impressions</TableHead>
          <TableHead className="text-right">Median eng. rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell>
              <span className="flex flex-wrap items-center gap-x-2">
                {r.name}
                {r.note ? <span className="text-xs text-muted-foreground">{r.note}</span> : null}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(r.posts)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {r.medianImpressions === null ? dash : formatNumber(Math.round(r.medianImpressions))}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {r.medianRate === null ? dash : formatRate(r.medianRate)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ByType({ data, label }: { data: InsightsData; label: string }) {
  const rows = data.byType.filter((t) => t.posts > 0)
  return (
    <Card className="t-rise" style={{ "--i": 1 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>By post type</CardTitle>
        <CardDescription>Median impressions per post, {label}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MedianBarChart
          orientation="horizontal"
          label={`Median impressions by post type, ${label}: ${rows
            .map((t) => `${POST_TYPE_META[t.type].plural} ${formatNumber(Math.round(t.medianImpressions ?? 0))}`)
            .join(", ")}.`}
          data={rows.map((t) => ({
            label: POST_TYPE_META[t.type].plural,
            value: t.medianImpressions === null ? null : Math.round(t.medianImpressions),
            color: POST_TYPE_COLORS[t.type],
            posts: t.posts,
          }))}
        />
        <PerformanceTable
          first="Type"
          rows={rows.map((t) => ({
            key: t.type,
            name: <PostTypeBadge type={t.type} />,
            posts: t.posts,
            medianImpressions: t.medianImpressions,
            medianRate: t.medianRate,
          }))}
        />
      </CardContent>
    </Card>
  )
}

function ByLength({ data, label }: { data: InsightsData; label: string }) {
  return (
    <Card className="t-rise" style={{ "--i": 2 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>By length</CardTitle>
        <CardDescription>
          Originals and quotes by characters of text (links and @mentions not counted), {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <MedianBarChart
          orientation="vertical"
          label={`Median impressions by text length, ${label}: ${data.byLength
            .map((b) => `${b.label} characters ${b.enough ? formatNumber(Math.round(b.medianImpressions!)) : "too few posts"}`)
            .join(", ")}.`}
          // A bucket with only a few posts gets no bar, so one outlier can't set the scale.
          data={data.byLength.map((b) => ({
            label: b.label,
            value: b.enough ? Math.round(b.medianImpressions!) : null,
            posts: b.posts,
          }))}
        />
        <PerformanceTable
          first="Characters"
          rows={data.byLength.map((b) => ({
            key: b.key,
            name: <span className="tabular-nums">{b.label}</span>,
            posts: b.posts,
            medianImpressions: b.medianImpressions,
            medianRate: b.medianRate,
            note: b.posts > 0 && !b.enough ? `few posts (under ${LENGTH_MIN_POSTS})` : undefined,
          }))}
        />
      </CardContent>
    </Card>
  )
}

function TopEngagement({ data, label, timeZone }: { data: InsightsData; label: string; timeZone: string }) {
  const { posts, minImpressions } = data.topEngagement
  return (
    <Card className="t-rise" style={{ "--i": 3 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>Top posts by engagement rate</CardTitle>
        <CardDescription>
          Originals and quotes with at least {formatNumber(minImpressions)} impressions (the median),{" "}
          {label}. Rate = likes, replies, reposts, quotes and bookmarks per impression.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts reach that many impressions in this range yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Engagements</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell className="w-full max-w-0">
                    <div className="flex flex-col gap-1">
                      <span className="truncate font-medium" title={post.text}>
                        {post.text}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <PostTypeBadge type={post.type} />
                        {formatPostDate(post.createdAt, timeZone)}
                        <a
                          href={postHref(post)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 underline-offset-4 hover:underline"
                        >
                          Open on X
                          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatRate(post.rate)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatNumber(post.engagements)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={formatNumber(post.impressions)}>
                    {formatCompact(post.impressions)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums tracking-tight">{value}</dd>
      {detail ? <dd className="text-xs text-muted-foreground tabular-nums">{detail}</dd> : null}
    </div>
  )
}

function Consistency({ data, label }: { data: InsightsData; label: string }) {
  const c = data.consistency
  const longest = c.longestStreak
  const activeShare = c.days ? Math.round((c.activeDays / c.days) * 100) : 0
  const summary =
    `Posts and replies per week, ${label}: ${formatNumber(c.posts)} posts and ` +
    `${formatNumber(c.replies)} replies over ${plural(c.weeks.length, "week", "weeks")}.`
  return (
    <Card className="t-rise" style={{ "--i": 4 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>Posting consistency</CardTitle>
        <CardDescription>
          Originals and quotes, {label}. Replies are shown but don&apos;t count toward streaks.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Posts per day" value={oneDecimal.format(c.postsPerDay)} detail={`${oneDecimal.format(c.repliesPerDay)} replies per day`} />
          <Stat label="Posts per week" value={oneDecimal.format(c.postsPerWeek)} detail={`${formatNumber(c.posts)} in ${plural(c.days, "day", "days")}`} />
          <Stat label="Days with a post" value={`${activeShare}%`} detail={`${formatNumber(c.activeDays)} of ${formatNumber(c.days)}`} />
          <Stat label="Current streak" value={plural(c.currentStreak, "day", "days")} detail="Ending today or yesterday" />
          <Stat
            label="Longest streak"
            value={longest ? plural(longest.days, "day", "days") : "0 days"}
            detail={longest ? `${formatDayKey(longest.from)} ${dash} ${formatDayKey(longest.to)}` : "No posts in range"}
          />
        </dl>
        <WeeklyPostsChart weeks={c.weeks} label={summary} />
      </CardContent>
    </Card>
  )
}

/** All /insights sections for the ?range= in the URL, in the settings timezone. */
export async function Insights({ searchParams }: { searchParams: SearchParams }) {
  const [params, settings] = await Promise.all([searchParams, getSettings()])
  const data = await getInsights(parseInsightsRange(params.range), settings.timeZone)

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No posts yet</CardTitle>
          <CardDescription>Insights appear once posts have been imported.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const label = formatRangeLabel(data.range.from, data.range.to)
  return (
    <div className="flex flex-col gap-6">
      <BestTime data={data} zone={timeZoneAbbr(settings.timeZone)} label={label} />
      <section className="grid gap-4 lg:grid-cols-2" aria-label="What performs">
        <ByType data={data} label={label} />
        <ByLength data={data} label={label} />
      </section>
      <TopEngagement data={data} label={label} timeZone={settings.timeZone} />
      <Consistency data={data} label={label} />
    </div>
  )
}

export function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading insights">
      <Skeleton className="h-96 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}
