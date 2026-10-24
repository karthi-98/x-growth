"use client"

import "@/components/dashboard/charts.css"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { formatDayKey, formatNumber } from "@/lib/format"
import type { WeekCount } from "@/lib/insights/consistency"
import { POST_TYPE_COLORS } from "@/lib/post-types"

const chartConfig = {
  posts: { label: "Posts", color: POST_TYPE_COLORS.original },
  replies: { label: "Replies", color: POST_TYPE_COLORS.reply },
} satisfies ChartConfig

/** Whole-number ticks on a round step (0, 5, 10 ...). */
function countTicks(max: number, count = 4) {
  const raw = Math.max(1, max) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s))!)
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}

/** Posts and replies per week (weeks start Monday), side by side. */
export function WeeklyPostsChart({ weeks, label }: { weeks: WeekCount[]; label: string }) {
  const reduceMotion = useReducedMotion()
  const ticks = countTicks(Math.max(0, ...weeks.map((w) => Math.max(w.posts, w.replies))))

  return (
    <ChartContainer
      config={chartConfig}
      role="img"
      aria-label={label}
      className="t-area-chart aspect-auto h-56 w-full"
    >
      <BarChart data={weeks} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis
          dataKey="week"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          minTickGap={24}
          interval="preserveStartEnd"
          tickFormatter={(v: string) => formatDayKey(v)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          tickMargin={4}
          domain={[0, ticks[ticks.length - 1]]}
          ticks={ticks}
          allowDecimals={false}
          tickFormatter={(v: number) => formatNumber(v)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          isAnimationActive={!reduceMotion}
          animationDuration={180}
          content={
            <ChartTooltipContent
              indicator="line"
              className="min-w-44"
              labelFormatter={(_, payload) => {
                const w = payload?.[0]?.payload as WeekCount | undefined
                if (!w) return null
                const partial = w.days < 7 ? ` (${w.days} ${w.days === 1 ? "day" : "days"})` : ""
                return `Week of ${formatDayKey(w.week)}${partial}`
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {(["posts", "replies"] as const).map((key) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`var(--color-${key})`}
            fillOpacity={0.85}
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
            activeBar={{ fillOpacity: 1 }}
            isAnimationActive={!reduceMotion}
            animationDuration={500}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
