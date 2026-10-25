import { describe, expect, test } from "bun:test"

import { median, rankSlots } from "./best-time"
import { formatInZone, monthStartUtc, nextZonedSlot, utcToZonedLocal, zonedLocalToUtc, zonedWeekdayHour } from "./zoned"

describe("wall-clock times in the user's timezone", () => {
  test("local → UTC and back", () => {
    expect(zonedLocalToUtc("2026-10-25T18:00", "Asia/Kolkata")).toBe("2026-10-25T12:30:00.000Z")
    expect(zonedLocalToUtc("2026-10-25T18:00", "UTC")).toBe("2026-10-25T18:00:00.000Z")
    expect(utcToZonedLocal("2026-10-25T12:30:00.000Z", "Asia/Kolkata")).toBe("2026-10-25T18:00")
    expect(zonedLocalToUtc("not a date", "UTC")).toBeNull()
    expect(zonedLocalToUtc("2026-13-01T00:00", "UTC")).toBeNull()
  })

  test("DST: New York before and after the November switch", () => {
    expect(zonedLocalToUtc("2026-10-31T12:00", "America/New_York")).toBe("2026-10-31T16:00:00.000Z")
    expect(zonedLocalToUtc("2026-11-02T12:00", "America/New_York")).toBe("2026-11-02T17:00:00.000Z")
  })

  test("weekday and hour, month start, labels", () => {
    // 2026-10-25 is a Sunday; 20:00 UTC is Monday 01:30 in Kolkata.
    expect(zonedWeekdayHour(new Date("2026-10-25T20:00:00Z"), "Asia/Kolkata")).toEqual({ weekday: 1, hour: 1 })
    expect(monthStartUtc(new Date("2026-10-31T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-31T18:30:00.000Z")
    expect(formatInZone("2026-10-25T12:30:00Z", "Asia/Kolkata")).toBe("Sun 25 Oct, 18:00")
  })

  test("next occurrence of a weekday slot", () => {
    const now = new Date("2026-10-25T12:00:00Z") // Sunday
    expect(nextZonedSlot(now, "UTC", 2, 18).local).toBe("2026-10-27T18:00") // Tuesday
    expect(nextZonedSlot(now, "UTC", 0, 18).local).toBe("2026-10-25T18:00") // later today
    expect(nextZonedSlot(now, "UTC", 0, 9).local).toBe("2026-11-01T09:00") // today's has passed
  })
})

describe("best time", () => {
  test("median", () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  test("ranks weekday × hour slots by median, ignoring thin slots and outliers", () => {
    const at = (iso: string, impressions: number) => ({ createdAt: iso, impressions })
    const rows = [
      // Tuesdays 18:xx UTC: steady
      at("2026-10-06T18:05:00Z", 900),
      at("2026-10-13T18:10:00Z", 1000),
      at("2026-10-20T18:40:00Z", 1100),
      // Mondays 09:xx: one viral post, low median
      at("2026-10-05T09:00:00Z", 50_000),
      at("2026-10-12T09:00:00Z", 100),
      at("2026-10-19T09:00:00Z", 120),
      // Only two posts: not ranked
      at("2026-10-07T07:00:00Z", 9_999),
      at("2026-10-14T07:00:00Z", 9_999),
    ]
    const slots = rankSlots(rows, "UTC", new Date("2026-10-25T12:00:00Z"), { minPosts: 3 })
    expect(slots.map((s) => [s.label, s.median, s.posts])).toEqual([
      ["Tue 18:00", 1000, 3],
      ["Mon 09:00", 120, 3],
    ])
    expect(slots[0].next.local).toBe("2026-10-27T18:00")
  })
})
