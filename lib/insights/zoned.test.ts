import { describe, expect, test } from "bun:test"

import { addDays, zonedDayStartUtc } from "@/lib/dates"
import { countActivityByDay, sumByPostDay, type MetricRow } from "@/lib/insights/daily"
import { dayStartMs, weekStart, zonedDays, zonedParts } from "@/lib/insights/zoned"

const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()
const dayLengths = (from: string, to: string, tz: string) => {
  const { bounds } = zonedDays(from, to, tz)
  return bounds.slice(1).map((b, i) => (b - bounds[i]) / HOUR)
}

describe("dayStartMs", () => {
  test("matches zonedDayStartUtc across zones and DST changes", () => {
    for (const tz of ["Asia/Kolkata", "America/New_York", "Europe/London", "Australia/Sydney", "UTC"]) {
      for (let d = "2026-01-01"; d <= "2026-12-31"; d = addDays(d, 7)) {
        expect(iso(dayStartMs(d, tz))).toBe(zonedDayStartUtc(d, tz))
      }
      for (const d of ["2026-03-08", "2026-03-09", "2026-03-29", "2026-04-05", "2026-10-04", "2026-10-25", "2026-11-01", "2026-11-02"]) {
        expect(iso(dayStartMs(d, tz))).toBe(zonedDayStartUtc(d, tz))
      }
    }
  })
})

describe("zonedDays in IST (UTC+5:30, no DST)", () => {
  const tz = "Asia/Kolkata"
  const days = zonedDays("2026-10-23", "2026-10-24", tz)

  test("bounds are local midnights", () => {
    expect(days.keys).toEqual(["2026-10-23", "2026-10-24"])
    expect(days.start).toBe("2026-10-22T18:30:00.000Z")
    expect(days.end).toBe("2026-10-24T18:30:00.000Z")
  })

  test("buckets around local midnight", () => {
    expect(days.indexOf("2026-10-22T18:29:59.999Z")).toBe(-1)
    expect(days.indexOf("2026-10-22T18:30:00.000Z")).toBe(0)
    expect(days.indexOf("2026-10-23T18:29:59.999Z")).toBe(0)
    expect(days.indexOf("2026-10-23T18:30:00.000Z")).toBe(1)
    expect(days.indexOf("2026-10-24T18:30:00.000Z")).toBe(-1)
  })

  test("zonedParts reads the local day, weekday and hour", () => {
    // 18:30Z on Sat 24 Oct is 00:00 on Sun 25 Oct in IST.
    expect(zonedParts("2026-10-24T18:30:00Z", tz)).toEqual({ key: "2026-10-25", weekday: 6, hour: 0 })
    expect(zonedParts("2026-10-20T03:30:00Z", tz)).toEqual({ key: "2026-10-20", weekday: 1, hour: 9 })
  })
})

describe("zonedDays in America/New_York across DST changes", () => {
  const tz = "America/New_York"

  test("fall back (1 Nov 2026) makes a 25-hour day", () => {
    const days = zonedDays("2026-10-31", "2026-11-02", tz)
    expect(days.start).toBe("2026-10-31T04:00:00.000Z") // EDT, UTC-4
    expect(days.bounds.map(iso)).toEqual([
      "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z", // EST, UTC-5
      "2026-11-03T05:00:00.000Z",
    ])
    expect(dayLengths("2026-10-31", "2026-11-02", tz)).toEqual([24, 25, 24])
    // 23:30 EST on 1 Nov: a fixed EDT offset would wrongly call it 2 Nov.
    expect(days.indexOf("2026-11-02T04:30:00Z")).toBe(1)
    expect(days.indexOf("2026-11-02T05:00:00Z")).toBe(2)
  })

  test("spring forward (8 Mar 2026) makes a 23-hour day", () => {
    expect(dayLengths("2026-03-07", "2026-03-09", tz)).toEqual([24, 23, 24])
    const days = zonedDays("2026-03-08", "2026-03-08", tz)
    expect(days.start).toBe("2026-03-08T05:00:00.000Z")
    expect(days.end).toBe("2026-03-09T04:00:00.000Z")
    expect(days.indexOf("2026-03-09T03:59:59Z")).toBe(0)
    expect(days.indexOf("2026-03-09T04:00:00Z")).toBe(-1)
  })

  test("the repeated 1 am hour on fall-back day stays hour 1", () => {
    expect(zonedParts("2026-11-01T05:30:00Z", tz)).toEqual({ key: "2026-11-01", weekday: 6, hour: 1 }) // 1:30 EDT
    expect(zonedParts("2026-11-01T06:30:00Z", tz)).toEqual({ key: "2026-11-01", weekday: 6, hour: 1 }) // 1:30 EST
  })
})

describe("zonedDays in UTC", () => {
  test("days are plain UTC dates", () => {
    const days = zonedDays("2026-10-24", "2026-10-25", "UTC")
    expect(days.start).toBe("2026-10-24T00:00:00.000Z")
    expect(days.end).toBe("2026-10-26T00:00:00.000Z")
    expect(days.indexOf("2026-10-24T23:59:59Z")).toBe(0)
    expect(days.indexOf("2026-10-25T00:00:00Z")).toBe(1)
  })
})

describe("daily totals follow the timezone", () => {
  const row = (createdAt: string, impressions: number, type: MetricRow["type"] = "original"): MetricRow => ({
    createdAt,
    type,
    impressions,
    likes: 1,
    replies: 0,
    bookmarks: 0,
  })
  // 20:00Z on 24 Oct is 25 Oct 01:30 in IST but still 24 Oct in UTC and New York.
  const rows = [
    row("2026-10-24T10:00:00Z", 100),
    row("2026-10-24T20:00:00Z", 50),
    row("2026-10-24T21:00:00Z", 999, "repost"),
  ]

  test("IST moves the late post to the next day", () => {
    const out = sumByPostDay(rows, zonedDays("2026-10-24", "2026-10-25", "Asia/Kolkata"))
    expect(out.map((d) => [d.date, d.posts, d.impressions])).toEqual([
      ["2026-10-24", 1, 100],
      ["2026-10-25", 1, 50],
    ])
  })

  test("UTC keeps both on the 24th; reposts never count", () => {
    const out = sumByPostDay(rows, zonedDays("2026-10-24", "2026-10-25", "UTC"))
    expect(out.map((d) => [d.date, d.posts, d.impressions, d.likes])).toEqual([
      ["2026-10-24", 2, 150, 2],
      ["2026-10-25", 0, 0, 0],
    ])
  })

  test("activity counts bucket across the New York fall-back day", () => {
    const out = countActivityByDay(
      [
        { createdAt: "2026-11-02T04:30:00Z", type: "original" }, // 1 Nov 23:30 EST
        { createdAt: "2026-11-02T05:30:00Z", type: "quote" }, // 2 Nov 00:30 EST
        { createdAt: "2026-11-01T12:00:00Z", type: "reply" },
        { createdAt: "2026-11-01T13:00:00Z", type: "repost" },
      ],
      "2026-11-01",
      "2026-11-02",
      "America/New_York"
    )
    expect(out).toEqual([
      { date: "2026-11-01", posts: 1, replies: 1 },
      { date: "2026-11-02", posts: 1, replies: 0 },
    ])
  })
})

test("weekStart is the Monday on or before a date", () => {
  expect(weekStart("2026-10-24")).toBe("2026-10-19") // Saturday
  expect(weekStart("2026-10-19")).toBe("2026-10-19") // Monday
  expect(weekStart("2026-10-25")).toBe("2026-10-19") // Sunday
})
