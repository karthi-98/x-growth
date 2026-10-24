"use client"

import "./charts.css"
import "./activity-chart.css"

import { MessagesSquareIcon } from "lucide-react"
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { GlideBand, GlideCursor } from "@/components/dashboard/chart-cursors"
import { DaySyncSeed, daySyncProps } from "@/components/dashboard/chart-hover-sync"
import {
  ChartCrossfade,
  ChartTypeSelect,
  useChartType,
} from "@/components/dashboard/chart-type-select"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { ActivityData } from "@/lib/activity-query"
import { formatDayKey, formatNumber, formatRangeLabel } from "@/lib/format"
import { POST_TYPE_COLORS } from "@/lib/post-types"
import { cn } from "@/lib/utils"

type SeriesKey = "posts" | "replies"

const chartConfig = {
  posts: { label: "Posts", color: POST_TYPE_COLORS.original },
  replies: { label: "Replies", color: POST_TYPE_COLORS.reply },
} satisfies ChartConfig

/** Series in paint order: posts behind, replies on top. */
const SERIES: { key: SeriesKey; fillTop: number; begin: number }[] = [
  { key: "posts", fillTop: 0.22, begin: 120 },
  { key: "replies", fillTop: 0.16, begin: 200 },
]

const Y_TICKS = 4
/** Past this many days the x axis switches from "24 Oct" to month starts. */
const MONTH_TICKS_AFTER = 75
const MAX_X_TICKS = 8
/** This card's name in the shared day hover (see chart-hover-sync). */
const SYNC_SOURCE = "activity"

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })
const monthShort = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" })

/** "Thu, 24 Oct" from a YYYY-MM-DD key. */
function formatTooltipDay(key: string) {
  return `${weekday.format(new Date(`${key}T00:00:00Z`))}, ${formatDayKey(key)}`
}

/** "Jun", or "Jun 26" when the range crosses a year boundary. */
function formatMonthTick(key: string, withYear: boolean) {
  const m = monthShort.format(new Date(`${key}T00:00:00Z`)).replace("Sept", "Sep")
  return withYear ? `${m} ${key.slice(2, 4)}` : m
}

/** Whole-number y ticks on a round step (0, 2, 4 ... or 0, 5, 10 ...). */
function countTicks(max: number, count = Y_TICKS) {
  const raw = Math.max(1, max) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s))!)
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

/** Month-start ticks for long ranges, thinned to at most MAX_X_TICKS. */
function monthTicks(dates: string[]) {
  const starts = dates.filter((d) => d.endsWith("-01"))
  const every = Math.ceil(starts.length / MAX_X_TICKS)
  return starts.filter((_, i) => i % every === 0)
}

function activeDot(key: SeriesKey) {
  function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
    if (cx == null || cy == null) return null
    return (
      <g
        className="t-activity-dot"
        style={{ transform: `translate(${cx}px, ${cy}px)`, "--dot-color": `var(--color-${key})` } as React.CSSProperties}
      >
        <circle r={9} className="t-activity-dot-halo" />
        <circle r={3.5} className="t-activity-dot-core" />
      </g>
    )
  }
  return ActiveDot
}
const ACTIVE_DOTS = { posts: activeDot("posts"), replies: activeDot("replies") }

/**
 * transitions.dev "Text swap soft": when `text` changes, cross-blur the old
 * value into the new one in place. React renders only the first value, so
 * the DOM swap never fights reconciliation.
 */
function SoftText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [first] = useState(text)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = el.dataset.text ?? el.textContent ?? ""
    if (prev === text) return
    el.dataset.text = text
    clearTimeout(timer.current)

    const out = document.createElement("span")
    out.className = "t-text-soft-old"
    out.setAttribute("aria-hidden", "true")
    out.textContent = prev
    const inn = document.createElement("span")
    inn.className = "t-text-soft-new"
    inn.textContent = text

    const w0 = el.getBoundingClientRect().width
    el.classList.remove("is-swapping")
    el.replaceChildren(out, inn)
    const w1 = inn.getBoundingClientRect().width
    el.style.width = `${w0}px`
    void el.offsetWidth // reflow so both transitions run
    el.classList.add("is-swapping")
    el.style.width = `${w1}px`

    timer.current = setTimeout(() => {
      el.classList.remove("is-swapping")
      el.style.removeProperty("width")
      el.textContent = text
    }, 280)
  }, [text])

  useLayoutEffect(() => () => clearTimeout(timer.current), [])

  return (
    <span ref={ref} className={cn("t-text-soft", className)}>
      {first}
    </span>
  )
}

function Total({ series, value }: { series: SeriesKey; value: number }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-[2px]"
          style={{ backgroundColor: chartConfig[series].color }}
        />
        {chartConfig[series].label}
      </span>
      <SoftText
        text={formatNumber(value)}
        className="text-xl font-semibold tabular-nums tracking-tight [--text-soft-align:end]"
      />
    </div>
  )
}

export function ActivityChartCard({ data }: { data: ActivityData }) {
  const { days, totals, range, hasReplies } = data
  const reduceMotion = useReducedMotion()
  const [chartType, setChartType] = useChartType("actChart")
  const uid = useId().replace(/:/g, "")
  const label = formatRangeLabel(range.from, range.to)
  const isEmpty = totals.posts === 0 && totals.replies === 0

  const yTicks = useMemo(
    () => countTicks(Math.max(0, ...days.map((d) => Math.max(d.posts, d.replies)))),
    [days]
  )
  const xAxis = useMemo(() => {
    const long = days.length > MONTH_TICKS_AFTER
    const crossesYear = range.from.slice(0, 4) !== range.to.slice(0, 4)
    return long
      ? {
          ticks: monthTicks(days.map((d) => d.date)),
          format: (v: string) => formatMonthTick(v, crossesYear),
        }
      : { ticks: undefined, format: (v: string) => formatDayKey(v) }
  }, [days, range.from, range.to])

  const dates = useMemo(() => days.map((d) => d.date), [days])
  const sync = daySyncProps(SYNC_SOURCE)

  const summary =
    `Posts and replies per day, ${label}: ` +
    `${formatNumber(totals.posts)} posts, ${formatNumber(totals.replies)} replies.`

  // Grid, axes, tooltip and legend, shared by the curve and bar renderings
  // so switching never moves the axes.
  const frame = (cursor: React.ReactElement, defaultIndex: number | undefined) => (
    <>
      <CartesianGrid vertical={false} strokeDasharray="2 4" />
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={28}
        ticks={xAxis.ticks}
        interval={xAxis.ticks ? 0 : "preserveStartEnd"}
        tickFormatter={xAxis.format}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={32}
        tickMargin={4}
        domain={[0, yTicks[yTicks.length - 1]]}
        ticks={yTicks}
        allowDecimals={false}
        tickFormatter={(v: number) => formatNumber(v)}
      />
      <ChartTooltip
        cursor={cursor}
        defaultIndex={defaultIndex}
        offset={16}
        position={{ y: 4 }}
        isAnimationActive={!reduceMotion}
        animationDuration={180}
        animationEasing="ease-out"
        content={
          <ChartTooltipContent
            indicator="line"
            className="min-w-40"
            labelFormatter={(_, payload) => {
              const key = payload?.[0]?.payload?.date
              return typeof key === "string" ? formatTooltipDay(key) : null
            }}
          />
        }
      />
      <ChartLegend content={<ChartLegendContent />} />
    </>
  )

  return (
    <Card className="t-rise" style={{ "--i": 7 } as React.CSSProperties}>
      <CardHeader>
        <CardTitle>Posts and replies</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>Daily, by post date, {label}</span>
          {!hasReplies ? <Badge variant="outline">Replies not imported yet</Badge> : null}
        </CardDescription>
        <CardAction className="flex flex-col items-end gap-3">
          <ChartTypeSelect
            value={chartType}
            onValueChange={setChartType}
            label="Posts and replies chart type"
          />
          <div className="flex flex-wrap justify-end gap-x-5 gap-y-1" aria-live="polite">
            <Total series="posts" value={totals.posts} />
            <Total series="replies" value={totals.replies} />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div
            key="empty"
            className="t-chart-swap flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center"
          >
            <MessagesSquareIcon aria-hidden="true" className="text-muted-foreground" />
            <p className="text-sm font-medium">No posts or replies</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              Nothing was posted between {label}. Pick a wider range.
            </p>
          </div>
        ) : (
          <ChartCrossfade type={chartType} className="h-64 w-full">
            {(mode) => (
              <DaySyncSeed source={SYNC_SOURCE} dates={dates}>
                {(defaultIndex) => (
                  <ChartContainer
                    config={chartConfig}
                    role="group"
                    aria-label={summary}
                    className="t-area-chart aspect-auto h-64 w-full"
                  >
                    {mode === "bar" ? (
                      <BarChart
                        data={days}
                        margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
                        barGap={2}
                        barCategoryGap="20%"
                        {...sync}
                      >
                        {frame(<GlideBand />, defaultIndex)}
                        {SERIES.map(({ key }) => (
                          <Bar
                            key={key}
                            dataKey={key}
                            fill={`var(--color-${key})`}
                            fillOpacity={0.85}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={12}
                            activeBar={{ fillOpacity: 1 }}
                            isAnimationActive={!reduceMotion}
                            animationDuration={500}
                            animationEasing="ease-out"
                          />
                        ))}
                      </BarChart>
                    ) : (
                    <AreaChart data={days} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} {...sync}>
                      <defs>
                        {SERIES.map(({ key, fillTop }) => (
                          <linearGradient key={key} id={`fill-${key}-${uid}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={`var(--color-${key})`} stopOpacity={fillTop} />
                            <stop offset="60%" stopColor={`var(--color-${key})`} stopOpacity={fillTop / 3} />
                            <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      {frame(<GlideCursor />, defaultIndex)}
                      {SERIES.map(({ key, begin }) => (
                        <Area
                          key={key}
                          dataKey={key}
                          type="monotone"
                          baseValue={0}
                          fill={`url(#fill-${key}-${uid})`}
                          stroke={`var(--color-${key})`}
                          strokeWidth={1.75}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={days.length === 1 ? { r: 3.5, fill: `var(--color-${key})`, strokeWidth: 0 } : false}
                          activeDot={ACTIVE_DOTS[key]}
                          isAnimationActive={!reduceMotion}
                          animationBegin={begin}
                          animationDuration={700}
                          animationEasing="ease-out"
                        />
                      ))}
                    </AreaChart>
                    )}
                  </ChartContainer>
                )}
              </DaySyncSeed>
            )}
          </ChartCrossfade>
        )}
      </CardContent>
    </Card>
  )
}
