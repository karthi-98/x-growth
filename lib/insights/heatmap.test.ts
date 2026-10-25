import { describe, expect, test } from "bun:test"

import { buildHeatmap, formatHourSpan, heatThresholds, levelFor } from "@/lib/insights/heatmap"

const cell = (h: ReturnType<typeof buildHeatmap>, weekday: number, hour: number) => h.cells[weekday * 24 + hour]

// Tue 20 Oct 2026, 03:30Z = 09:00 IST = Mon 19 Oct 23:30 in New York (EDT).
const rows = [
  { createdAt: "2026-10-20T03:30:00Z", impressions: 100 },
  { createdAt: "2026-10-13T03:45:00Z", impressions: 300 },
  { createdAt: "2026-10-06T03:59:00Z", impressions: 200 },
  // Wed 21 Oct, 10:00 IST: only two posts, too few for a median.
  { createdAt: "2026-10-21T04:30:00Z", impressions: 5000 },
  { createdAt: "2026-10-14T04:30:00Z", impressions: 7000 },
]

describe("buildHeatmap", () => {
  test("groups by local weekday and hour, scoring the median", () => {
    const h = buildHeatmap(rows, "Asia/Kolkata", { minPosts: 3 })
    expect(h.posts).toBe(5)
    expect(h.cells).toHaveLength(7 * 24)
    expect(cell(h, 1, 9)).toMatchObject({ weekday: 1, hour: 9, posts: 3, median: 200 })
    expect(cell(h, 2, 10)).toMatchObject({ posts: 2, median: null, level: 0 })
    expect(cell(h, 0, 0)).toMatchObject({ posts: 0, median: null, level: 0 })
    expect(h.best.map((c) => [c.weekday, c.hour])).toEqual([[1, 9]])
  })

  test("the same posts land elsewhere in another timezone", () => {
    const h = buildHeatmap(rows, "America/New_York", { minPosts: 3 })
    expect(cell(h, 0, 23)).toMatchObject({ posts: 3, median: 200 }) // Monday 11 pm
    expect(cell(h, 1, 9).posts).toBe(0)
  })

  test("the minimum sample size is configurable", () => {
    const h = buildHeatmap(rows, "Asia/Kolkata", { minPosts: 2 })
    expect(cell(h, 2, 10)).toMatchObject({ posts: 2, median: 6000 })
    expect(h.best[0]).toMatchObject({ weekday: 2, hour: 10 })
    expect(cell(h, 2, 10).level).toBeGreaterThan(cell(h, 1, 9).level)
  })

  test("the default minimum (5 posts) leaves small cells unscored", () => {
    const h = buildHeatmap(rows, "Asia/Kolkata")
    expect(h.minPosts).toBe(5)
    expect(cell(h, 1, 9)).toMatchObject({ posts: 3, median: null, level: 0 })
    expect(h.best).toEqual([])
    expect(h.thresholds).toEqual([])
  })

  test("marginals by weekday and hour", () => {
    const h = buildHeatmap(rows, "Asia/Kolkata", { minPosts: 3 })
    expect(h.byWeekday[1]).toEqual({ weekday: 1, posts: 3, median: 200 })
    expect(h.byWeekday[2]).toEqual({ weekday: 2, posts: 2, median: null })
    expect(h.byHour[9]).toEqual({ hour: 9, posts: 3, median: 200 })
  })

  test("DST: both 1 am hours on New York's fall-back day count as 1 am Sunday", () => {
    const h = buildHeatmap(
      [
        { createdAt: "2026-11-01T05:30:00Z", impressions: 10 },
        { createdAt: "2026-11-01T06:30:00Z", impressions: 20 },
        { createdAt: "2026-11-08T06:30:00Z", impressions: 30 },
      ],
      "America/New_York",
      { minPosts: 3 }
    )
    expect(cell(h, 6, 1)).toMatchObject({ posts: 3, median: 20 })
  })
})

describe("colour steps", () => {
  test("quintile thresholds and levels", () => {
    const t = heatThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(t).toEqual([3, 5, 6, 8])
    expect([1, 3, 4, 6, 7, 10].map((v) => levelFor(v, t))).toEqual([1, 1, 2, 3, 4, 5])
  })

  test("identical medians collapse to one step", () => {
    const t = heatThresholds([500, 500, 500])
    expect(t).toEqual([500])
    expect(levelFor(500, t)).toBe(1)
  })

  test("no scored cells, no thresholds", () => {
    expect(heatThresholds([])).toEqual([])
  })
})

test("hour labels", () => {
  expect(formatHourSpan(0)).toBe("12–1 am")
  expect(formatHourSpan(9)).toBe("9–10 am")
  expect(formatHourSpan(11)).toBe("11 am–12 pm")
  expect(formatHourSpan(23)).toBe("11 pm–12 am")
})
