"use client"

import "./charts.css"

import { useId, useMemo } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { GlideBand, GlideCursor } from "@/components/dashboard/chart-cursors"
import { DaySyncSeed, daySyncProps } from "@/components/dashboard/chart-hover-sync"
import {
  ChartCrossfade,
  ChartTypeSelect,
  useChartType,
  type ChartType,
} from "@/components/dashboard/chart-type-select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { formatCompact, formatDayKey } from "@/lib/format"

const chartConfig = {
  impressions: { label: "Impressions", color: "var(--chart-1)" },
} satisfies ChartConfig

/** URL search param holding this chart's curve / bar choice. */
const CHART_PARAM = "impChart"
/** This card's name in the shared day hover (see chart-hover-sync). */
const SYNC_SOURCE = "impressions"
const Y_TICKS = 4

const weekday = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  timeZone: "UTC",
})

/** "Thu, 24 Oct" from a YYYY-MM-DD key. */
function formatTooltipDay(key: string) {
  return `${weekday.format(new Date(`${key}T00:00:00Z`))}, ${formatDayKey(key)}`
}

/** Evenly spaced y ticks on a round step (0, 75K, 150K, ...) above the max. */
function niceTicks(max: number, count = Y_TICKS) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].map((m) => m * mag).find((s) => s >= raw)!
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

function ActiveDot({ cx, cy }: { cx?: number; cy?: number }) {
  if (cx == null || cy == null) return null
  return (
    <g className="t-chart-dot" style={{ transform: `translate(${cx}px, ${cy}px)` }}>
      <circle r={10} className="t-chart-dot-halo" />
      <circle r={4} className="t-chart-dot-core" />
    </g>
  )
}

/** Header control for the Impressions card; reads and writes ?impChart. */
export function ImpressionsChartTypeSelect() {
  const [type, setType] = useChartType(CHART_PARAM)
  return (
    <ChartTypeSelect value={type} onValueChange={setType} label="Impressions chart type" />
  )
}

export function ImpressionsChart({
  data,
}: {
  data: { date: string; impressions: number }[]
}) {
  const reduceMotion = useReducedMotion()
  const [type] = useChartType(CHART_PARAM)
  const fillId = `fill-impressions-${useId().replace(/:/g, "")}`
  const ticks = useMemo(
    () => niceTicks(Math.max(0, ...data.map((d) => d.impressions))),
    [data]
  )
  const dates = useMemo(() => data.map((d) => d.date), [data])
  const sync = daySyncProps(SYNC_SOURCE)

  // Shared by both renderings so switching never moves the axes.
  const frame = (mode: ChartType, defaultIndex: number | undefined) => [
    <CartesianGrid key="grid" vertical={false} strokeDasharray="2 4" />,
    <XAxis
      key="x"
      dataKey="date"
      tickLine={false}
      axisLine={false}
      tickMargin={10}
      minTickGap={32}
      interval="preserveStartEnd"
      tickFormatter={(v: string) => formatDayKey(v)}
    />,
    <YAxis
      key="y"
      tickLine={false}
      axisLine={false}
      width={40}
      tickMargin={4}
      domain={[0, ticks[ticks.length - 1]]}
      ticks={ticks}
      allowDecimals={false}
      tickFormatter={(v: number) => formatCompact(v)}
    />,
    <ChartTooltip
      key="tooltip"
      cursor={mode === "bar" ? <GlideBand /> : <GlideCursor />}
      defaultIndex={defaultIndex}
      offset={16}
      position={{ y: 4 }}
      isAnimationActive={!reduceMotion}
      animationDuration={180}
      animationEasing="ease-out"
      content={
        <ChartTooltipContent
          indicator="line"
          className="min-w-44"
          labelFormatter={(_, payload) => {
            const key = payload?.[0]?.payload?.date
            return typeof key === "string" ? formatTooltipDay(key) : null
          }}
        />
      }
    />,
  ]

  const margin = { top: 12, right: 12, left: 0, bottom: 0 }

  return (
    <ChartCrossfade type={type} className="h-64 w-full">
      {(mode) => (
        <DaySyncSeed source={SYNC_SOURCE} dates={dates}>
          {(defaultIndex) => (
            <ChartContainer
              config={chartConfig}
              className="t-area-chart aspect-auto h-64 w-full"
            >
              {mode === "bar" ? (
                <BarChart data={data} margin={margin} barCategoryGap="18%" {...sync}>
                  {frame(mode, defaultIndex)}
                  <Bar
                    dataKey="impressions"
                    fill="var(--color-impressions)"
                    fillOpacity={0.85}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                    activeBar={{ fillOpacity: 1 }}
                    isAnimationActive={!reduceMotion}
                    animationDuration={500}
                    animationEasing="ease-out"
                  />
                </BarChart>
              ) : (
                <AreaChart data={data} margin={margin} {...sync}>
                  <defs>
                    <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-impressions)" stopOpacity={0.24} />
                      <stop offset="55%" stopColor="var(--color-impressions)" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="var(--color-impressions)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {frame(mode, defaultIndex)}
                  <Area
                    dataKey="impressions"
                    type="monotone"
                    baseValue={0}
                    fill={`url(#${fillId})`}
                    stroke="var(--color-impressions)"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    activeDot={ActiveDot}
                    isAnimationActive={!reduceMotion}
                    animationBegin={200}
                    animationDuration={700}
                    animationEasing="ease-out"
                  />
                </AreaChart>
              )}
            </ChartContainer>
          )}
        </DaySyncSeed>
      )}
    </ChartCrossfade>
  )
}
