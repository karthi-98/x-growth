"use client"

import "./charts.css"
import "./activity-chart.css"

import { UsersIcon } from "lucide-react"
import { useId, useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { GlideCursor } from "@/components/dashboard/chart-cursors"
import { DaySyncSeed, daySyncProps } from "@/components/dashboard/chart-hover-sync"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { formatCompact, formatDayKey } from "@/lib/format"
import type { FollowerPoint } from "@/lib/insights/growth"

const chartConfig = {
  followers: { label: "Followers", color: "var(--chart-1)" },
} satisfies ChartConfig

/** This card's name in the shared day hover (see chart-hover-sync). */
const SYNC_SOURCE = "followers"
const Y_TICKS = 4

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })

/** "Thu, 24 Oct" from a YYYY-MM-DD key. */
function formatTooltipDay(key: string) {
  return `${weekday.format(new Date(`${key}T00:00:00Z`))}, ${formatDayKey(key)}`
}

/**
 * Round ticks spanning [min, max] with some headroom. A follower count is a
 * level, not a quantity summed from zero, so the axis hugs the data.
 */
function levelTicks(min: number, max: number, count = Y_TICKS) {
  const span = Math.max(max - min, Math.max(10, max * 0.02))
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const lo = Math.max(0, Math.floor((min - step / 2) / step) * step)
  const ticks = [lo]
  while (ticks[ticks.length - 1] < max + step / 4) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null
  return (
    <g
      className="t-activity-dot"
      style={{ transform: `translate(${cx}px, ${cy}px)`, "--dot-color": "var(--color-followers)" } as React.CSSProperties}
    >
      <circle r={9} className="t-activity-dot-halo" />
      <circle r={3.5} className="t-activity-dot-core" />
    </g>
  )
}

export function FollowerGrowthChart({ points, summary }: { points: FollowerPoint[]; summary: string }) {
  const reduceMotion = useReducedMotion()
  const fillId = `fill-followers-${useId().replace(/:/g, "")}`
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const ticks = useMemo(() => {
    const values = points.flatMap((p) => (p.followers === null ? [] : [p.followers]))
    return levelTicks(Math.min(...values), Math.max(...values))
  }, [points])
  const sync = daySyncProps(SYNC_SOURCE)

  if (points.every((p) => p.followers === null)) {
    return (
      <div className="t-chart-swap flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
        <UsersIcon aria-hidden="true" className="text-muted-foreground" />
        <p className="text-sm font-medium">No follower counts in this range</p>
        <p className="max-w-72 text-xs text-muted-foreground">{summary}</p>
      </div>
    )
  }

  return (
    <DaySyncSeed source={SYNC_SOURCE} dates={dates}>
      {(defaultIndex) => (
        <ChartContainer
          config={chartConfig}
          role="group"
          aria-label={summary}
          className="t-area-chart aspect-auto h-56 w-full"
        >
          <AreaChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} {...sync}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-followers)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--color-followers)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="2 4" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              minTickGap={32}
              interval="preserveStartEnd"
              tickFormatter={(v: string) => formatDayKey(v)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickMargin={4}
              domain={[ticks[0], ticks[ticks.length - 1]]}
              ticks={ticks}
              allowDecimals={false}
              tickFormatter={(v: number) => formatCompact(v)}
            />
            <ChartTooltip
              cursor={<GlideCursor />}
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
            <Area
              dataKey="followers"
              type="monotone"
              fill={`url(#${fillId})`}
              stroke="var(--color-followers)"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={points.length === 1 ? { r: 3.5, fill: "var(--color-followers)", strokeWidth: 0 } : false}
              activeDot={ActiveDot}
              isAnimationActive={!reduceMotion}
              animationBegin={200}
              animationDuration={700}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ChartContainer>
      )}
    </DaySyncSeed>
  )
}
