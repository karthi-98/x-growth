"use client"

import "@/components/dashboard/charts.css"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { formatCompact } from "@/lib/format"

const chartConfig = {
  value: { label: "Median impressions", color: "var(--chart-1)" },
} satisfies ChartConfig

export type MedianBar = {
  label: string
  /** Median impressions; null draws no bar. */
  value: number | null
  /** Bar colour; defaults to the chart's slot-1 hue. */
  color?: string
  posts: number
}

/** Evenly spaced ticks on a round step from zero up past `max`. */
function niceTicks(max: number, count = 4) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].map((m) => m * mag).find((s) => s >= raw)!
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

/**
 * Median impressions per group as bars: horizontal for a few named groups
 * (post types), vertical columns for ordered buckets (text length). One
 * measure, one zero-based axis; the table next to it carries the rest.
 */
export function MedianBarChart({
  data,
  orientation,
  label,
}: {
  data: MedianBar[]
  orientation: "horizontal" | "vertical"
  /** Accessible summary of what the chart shows. */
  label: string
}) {
  const reduceMotion = useReducedMotion()
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value ?? 0)))
  const horizontal = orientation === "horizontal"
  const valueAxis = {
    type: "number" as const,
    domain: [0, ticks[ticks.length - 1]],
    ticks,
    tickLine: false,
    axisLine: false,
    allowDecimals: false,
    tickFormatter: (v: number) => formatCompact(v),
  }
  const categoryAxis = {
    type: "category" as const,
    dataKey: "label",
    tickLine: false,
    axisLine: false,
  }

  return (
    <ChartContainer
      config={chartConfig}
      role="img"
      aria-label={label}
      className={horizontal ? "t-area-chart aspect-auto h-40 w-full" : "t-area-chart aspect-auto h-56 w-full"}
    >
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        barCategoryGap={horizontal ? "28%" : "22%"}
      >
        <CartesianGrid horizontal={!horizontal} vertical={horizontal} strokeDasharray="2 4" />
        {horizontal ? (
          <>
            <XAxis {...valueAxis} tickMargin={8} />
            <YAxis {...categoryAxis} width={72} tickMargin={6} />
          </>
        ) : (
          <>
            <XAxis {...categoryAxis} tickMargin={10} interval={0} />
            <YAxis {...valueAxis} width={40} tickMargin={4} />
          </>
        )}
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          isAnimationActive={!reduceMotion}
          animationDuration={180}
          content={
            <ChartTooltipContent
              indicator="line"
              className="min-w-44"
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as MedianBar | undefined
                return row ? `${row.label} · ${row.posts} ${row.posts === 1 ? "post" : "posts"}` : null
              }}
            />
          }
        />
        <Bar
          dataKey="value"
          radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          maxBarSize={horizontal ? 22 : 44}
          isAnimationActive={!reduceMotion}
          animationDuration={500}
          animationEasing="ease-out"
        >
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.color ?? "var(--color-value)"}
              fillOpacity={0.9}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
