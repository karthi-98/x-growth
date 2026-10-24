import { median, quantileSorted } from "@/lib/insights/stats"
import { zonedParts } from "@/lib/insights/zoned"

/*
 * Best time to post: posts grouped by the local weekday and hour they went
 * out (settings timezone), scored by median impressions. Medians, because a
 * single viral post would swamp an average. Cells with fewer than
 * `minPosts` posts get no score.
 */

/** Posts a weekday x hour cell needs before its median counts. */
export const HEATMAP_MIN_POSTS = 5
/** Colour steps in the legend. */
export const HEATMAP_STEPS = 5

export type HeatCell = {
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number
  /** 0-23, local. */
  hour: number
  posts: number
  /** Median impressions, null below the minimum sample size. */
  median: number | null
  /** Colour step 1..steps, 0 when there are too few posts. */
  level: number
}

export type Marginal = { posts: number; median: number | null }

export type Heatmap = {
  /** 7 x 24 cells, weekday-major (index = weekday * 24 + hour). */
  cells: HeatCell[]
  /** Upper bounds of each colour step but the last, ascending. */
  thresholds: number[]
  minPosts: number
  /** Posts counted. */
  posts: number
  /** Up to three scored cells with the highest medians. */
  best: HeatCell[]
  byWeekday: (Marginal & { weekday: number })[]
  byHour: (Marginal & { hour: number })[]
}

/** Colour step (1-based) for a value given ascending thresholds. */
export function levelFor(value: number, thresholds: number[]): number {
  let level = 1
  for (const t of thresholds) if (value > t) level += 1
  return level
}

/**
 * Quantile cut points over the scored medians, so each colour step holds
 * about the same number of cells; duplicates collapse (fewer steps used).
 */
export function heatThresholds(values: number[], steps = HEATMAP_STEPS): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const cuts: number[] = []
  for (let k = 1; k < steps; k++) {
    const q = quantileSorted(sorted, k / steps)
    if (q !== null && (cuts.length === 0 || q > cuts[cuts.length - 1])) cuts.push(Math.round(q))
  }
  return cuts
}

export function buildHeatmap(
  rows: { createdAt: string; impressions: number }[],
  timeZone: string,
  { minPosts = HEATMAP_MIN_POSTS, steps = HEATMAP_STEPS } = {}
): Heatmap {
  const buckets: number[][] = Array.from({ length: 7 * 24 }, () => [])
  const weekdays: number[][] = Array.from({ length: 7 }, () => [])
  const hours: number[][] = Array.from({ length: 24 }, () => [])
  for (const r of rows) {
    const { weekday, hour } = zonedParts(r.createdAt, timeZone)
    buckets[weekday * 24 + hour].push(r.impressions)
    weekdays[weekday].push(r.impressions)
    hours[hour].push(r.impressions)
  }

  const scored = (values: number[]) => (values.length >= minPosts ? median(values) : null)
  const medians = buckets.map(scored)
  const thresholds = heatThresholds(
    medians.filter((m): m is number => m !== null),
    steps
  )
  const cells = buckets.map((values, i) => {
    const m = medians[i]
    return {
      weekday: Math.floor(i / 24),
      hour: i % 24,
      posts: values.length,
      median: m,
      level: m === null ? 0 : levelFor(m, thresholds),
    }
  })

  const best = cells
    .filter((c) => c.median !== null)
    .sort((a, b) => b.median! - a.median! || b.posts - a.posts)
    .slice(0, 3)

  return {
    cells,
    thresholds,
    minPosts,
    posts: rows.length,
    best,
    byWeekday: weekdays.map((values, weekday) => ({ weekday, posts: values.length, median: scored(values) })),
    byHour: hours.map((values, hour) => ({ hour, posts: values.length, median: scored(values) })),
  }
}

/** "9 am", "12 pm", "12 am". */
export function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h} ${hour < 12 ? "am" : "pm"}`
}

/** "9-10 am", "11 am-12 pm" for the hour starting at `hour`. */
export function formatHourSpan(hour: number): string {
  const start = formatHour(hour)
  const end = formatHour((hour + 1) % 24)
  return start.slice(-2) === end.slice(-2) ? `${start.slice(0, -3)}–${end}` : `${start}–${end}`
}
