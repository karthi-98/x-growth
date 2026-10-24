import { describe, expect, test } from "bun:test"

import { followerGrowth, gainedPerDay, trackedFromDay } from "@/lib/insights/growth"

describe("followerGrowth", () => {
  const snaps = [
    { takenAt: "2026-10-20T02:30:00Z", followers: 1000 },
    { takenAt: "2026-10-21T02:30:00Z", followers: 1010 },
    { takenAt: "2026-10-21T16:30:00Z", followers: 1015 },
    // 19:00Z on 22 Oct is 23 Oct 00:30 in IST.
    { takenAt: "2026-10-22T19:00:00Z", followers: 1030 },
  ]

  test("end-of-day counts in IST, change from the count before the range", () => {
    const g = followerGrowth(snaps, "2026-10-21", "2026-10-23", "Asia/Kolkata")
    expect(g.points).toEqual([
      { date: "2026-10-21", followers: 1015 },
      { date: "2026-10-22", followers: 1015 },
      { date: "2026-10-23", followers: 1030 },
    ])
    expect(g.latest).toEqual({ followers: 1030, takenAt: "2026-10-22T19:00:00Z" })
    expect(g.change).toBe(30)
    expect(g.startedInRange).toBe(false)
  })

  test("in UTC the late snapshot stays on the 22nd", () => {
    const g = followerGrowth(snaps, "2026-10-21", "2026-10-23", "UTC")
    expect(g.points.map((p) => p.followers)).toEqual([1015, 1030, 1030])
  })

  test("tracking that starts mid-range measures from the first count", () => {
    const g = followerGrowth(snaps, "2026-10-19", "2026-10-21", "Asia/Kolkata")
    expect(g.points.map((p) => p.followers)).toEqual([null, 1000, 1015])
    expect(g.change).toBe(15)
    expect(g.startedInRange).toBe(true)
  })

  test("no snapshots", () => {
    const g = followerGrowth([], "2026-10-21", "2026-10-23", "UTC")
    expect(g.latest).toBeNull()
    expect(g.change).toBeNull()
    expect(g.points.every((p) => p.followers === null)).toBe(true)
  })
})

describe("impressions gained per day", () => {
  test("needs two full tracked days before replacing the fallback", () => {
    const first = "2026-10-10T02:30:00Z" // 10 Oct in IST
    expect(trackedFromDay(null, "2026-10-24", "Asia/Kolkata")).toBeNull()
    expect(trackedFromDay(first, "2026-10-11", "Asia/Kolkata")).toBeNull()
    expect(trackedFromDay(first, "2026-10-12", "Asia/Kolkata")).toBeNull()
    expect(trackedFromDay(first, "2026-10-13", "Asia/Kolkata")).toBe("2026-10-11")
  })

  test("sums sync deltas per local day, null before tracking", () => {
    const rows = [
      { at: "2026-10-11T02:30:00Z", gained: 7 }, // 10 Oct 22:30 EDT, before tracking
      { at: "2026-10-11T14:30:00Z", gained: 100 },
      { at: "2026-10-12T03:30:00Z", gained: 40 }, // 11 Oct 23:30 EDT
      { at: "2026-10-12T04:30:00Z", gained: 60 }, // 12 Oct 00:30 EDT
    ]
    const g = gainedPerDay(rows, "2026-10-10", "2026-10-12", "America/New_York", "2026-10-11")
    expect(g?.series).toEqual([
      { date: "2026-10-10", impressions: null },
      { date: "2026-10-11", impressions: 140 },
      { date: "2026-10-12", impressions: 60 },
    ])
  })

  test("falls back when untracked or the range ends before tracking", () => {
    expect(gainedPerDay([], "2026-10-01", "2026-10-12", "UTC", null)).toBeNull()
    expect(gainedPerDay([], "2026-10-01", "2026-10-10", "UTC", "2026-10-11")).toBeNull()
  })
})
