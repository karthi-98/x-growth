import { describe, expect, test } from "bun:test"

import type { SyncSettings } from "../settings"
import {
  computeCoverage,
  isFullRefresh,
  MAX_CATCH_UP_DAYS,
  mergeIntervals,
  nextReminderAt,
  planNext,
  zonedTimeUtc,
} from "./window"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = new Date("2026-10-24T12:00:00Z")
const ago = (ms: number, from = now) => new Date(from.getTime() - ms).toISOString()
// DEFAULT_SETTINGS.sync, inlined: importing lib/settings would open the database.
const sync: SyncSettings = {
  backfillDays: 90,
  fullRefreshDays: 7,
  lightRefreshHours: 24,
  refreshReplies: "all",
  reminderTimes: ["08:00", "13:00", "18:00", "22:00"],
  webhookUrl: null,
}

describe("mergeIntervals", () => {
  test("merges overlapping and touching windows, keeps holes", () => {
    const merged = mergeIntervals([
      { from: "2026-10-03T00:00:00Z", to: "2026-10-04T00:00:00Z" },
      { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z" },
      { from: "2026-10-02T00:00:00Z", to: "2026-10-02T12:00:00Z" },
    ])
    expect(merged).toEqual([
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T12:00:00.000Z" },
      { from: "2026-10-03T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" },
    ])
  })
})

describe("computeCoverage", () => {
  const backfill = { from: ago(90 * DAY), to: ago(3 * DAY) }

  test("a complete backfill establishes coverage", () => {
    const c = computeCoverage({ lastOkTo: null, windows: [backfill], now, backfillDays: 90 })
    expect(c).toMatchObject({ live: true, established: true, lastOkTo: new Date(backfill.to).toISOString(), gap: null })
  })

  test("a refresh before any backfill is not coverage; the rest of the backfill is the gap", () => {
    const light = { from: ago(DAY), to: now.toISOString() }
    const c = computeCoverage({ lastOkTo: null, windows: [light], now, backfillDays: 90 })
    expect(c.live).toBe(false)
    expect(c.gap).toEqual({ from: ago(90 * DAY), to: new Date(light.from).toISOString() })
  })

  test("a window touching coverage advances last_ok_to", () => {
    const lastOkTo = ago(5 * HOUR)
    const light = { from: ago(6 * HOUR), to: now.toISOString() }
    const c = computeCoverage({ lastOkTo, windows: [backfill, { from: backfill.to, to: lastOkTo }, light], now, backfillDays: 90 })
    expect(c).toMatchObject({ live: true, lastOkTo: now.toISOString(), gap: null })
  })

  test("a detached window leaves last_ok_to alone and reports the hole, starting 1h early", () => {
    const light = { from: ago(DAY), to: now.toISOString() }
    const c = computeCoverage({ lastOkTo: backfill.to, windows: [backfill, light], now, backfillDays: 90 })
    expect(c.lastOkTo).toBe(new Date(backfill.to).toISOString())
    expect(c.gap).toEqual({ from: ago(3 * DAY + HOUR), to: new Date(light.from).toISOString() })
  })

  test("filling the gap re-attaches the detached window", () => {
    const light = { from: ago(DAY), to: now.toISOString() }
    const catchUp = { from: ago(3 * DAY + HOUR), to: light.from }
    const c = computeCoverage({ lastOkTo: backfill.to, windows: [backfill, light, catchUp], now, backfillDays: 90 })
    expect(c).toMatchObject({ lastOkTo: now.toISOString(), gap: null })
  })

  test("the catch-up gap never reaches back more than 90 days", () => {
    const lastOkTo = ago(MAX_CATCH_UP_DAYS * DAY - 30 * 60_000)
    const light = { from: ago(DAY), to: now.toISOString() }
    const c = computeCoverage({ lastOkTo, windows: [light], now, backfillDays: 90 })
    expect(c.gap?.from).toBe(ago(MAX_CATCH_UP_DAYS * DAY))
  })

  test("coverage older than 90 days expires: refreshes don't revive it, a backfill does", () => {
    const old = ago(100 * DAY)
    const light = { from: ago(DAY), to: now.toISOString() }
    const stale = computeCoverage({ lastOkTo: old, windows: [light], now, backfillDays: 90 })
    expect(stale.live).toBe(false)
    expect(stale.lastOkTo).toBe(old)
    const fresh = computeCoverage({ lastOkTo: old, windows: [light, { from: ago(90 * DAY), to: light.from }], now, backfillDays: 90 })
    expect(fresh).toMatchObject({ live: true, established: true, lastOkTo: now.toISOString() })
  })
})

describe("planNext", () => {
  const live = { live: true, lastOkTo: ago(HOUR) }
  const base = {
    coverage: live,
    lastFullRefreshDay: "2026-10-24",
    lastMentionId: "555",
    sync,
    timeZone: "Asia/Kolkata",
    runAt: now,
  }

  test("no coverage: backfill over the configured days", () => {
    const next = planNext({ ...base, coverage: { live: false, lastOkTo: null } })
    expect(next).toEqual({ type: "backfill", from: ago(90 * DAY), mentionsSinceId: "555", repliesFrom: ago(90 * DAY) })
    expect(planNext({ ...base, coverage: { live: false, lastOkTo: null }, sync: { ...sync, backfillDays: 30 } }).from).toBe(
      ago(30 * DAY)
    )
  })

  test("first run of a local day: full refresh over 7 days", () => {
    const next = planNext({ ...base, lastFullRefreshDay: "2026-10-23" })
    expect(next).toMatchObject({ type: "full", from: ago(7 * DAY), mentionsSinceId: "555" })
  })

  test("later runs the same day: light refresh over 24 hours", () => {
    expect(planNext(base)).toMatchObject({ type: "light", from: ago(DAY) })
  })

  test("missed runs: the window reaches back to last_ok_to - 1h and is a catch-up", () => {
    const next = planNext({ ...base, coverage: { live: true, lastOkTo: ago(2 * DAY) } })
    expect(next).toMatchObject({ type: "catch-up", from: ago(2 * DAY + HOUR) })
  })

  test("refreshReplies = new-only: replies only from the coverage end", () => {
    const next = planNext({ ...base, sync: { ...sync, refreshReplies: "new-only" } })
    expect(next.from).toBe(ago(DAY))
    expect(next.repliesFrom).toBe(ago(2 * HOUR))
    expect(planNext(base).repliesFrom).toBe(next.from)
  })

  test("the local day decides full vs light (non-IST timezone)", () => {
    // 06:30Z on 25 Oct is 23:30 on 24 Oct in Los Angeles but 12:00 on 25 Oct in Kolkata.
    const runAt = new Date("2026-10-25T06:30:00Z")
    const coverage = { live: true, lastOkTo: "2026-10-25T05:00:00Z" }
    expect(planNext({ ...base, coverage, runAt, timeZone: "America/Los_Angeles" }).type).toBe("light")
    expect(planNext({ ...base, coverage, runAt, timeZone: "Asia/Kolkata" }).type).toBe("full")
  })
})

describe("reminders across DST", () => {
  test("zonedTimeUtc follows the offset on each side of the change", () => {
    // New York springs forward on 8 Mar 2026 and falls back on 1 Nov 2026.
    expect(zonedTimeUtc("2026-03-07", "08:00", "America/New_York").toISOString()).toBe("2026-03-07T13:00:00.000Z")
    expect(zonedTimeUtc("2026-03-08", "08:00", "America/New_York").toISOString()).toBe("2026-03-08T12:00:00.000Z")
    expect(zonedTimeUtc("2026-11-01", "08:00", "America/New_York").toISOString()).toBe("2026-11-01T13:00:00.000Z")
    // London falls back on 25 Oct 2026.
    expect(zonedTimeUtc("2026-10-24", "08:00", "Europe/London").toISOString()).toBe("2026-10-24T07:00:00.000Z")
    expect(zonedTimeUtc("2026-10-25", "08:00", "Europe/London").toISOString()).toBe("2026-10-25T08:00:00.000Z")
  })

  test("nextReminderAt crosses midnight and the DST change", () => {
    const times = ["22:00", "08:00"]
    expect(nextReminderAt(new Date("2026-03-07T23:00:00Z"), times, "America/New_York")?.toISOString()).toBe(
      "2026-03-08T03:00:00.000Z"
    )
    expect(nextReminderAt(new Date("2026-03-08T03:30:00Z"), times, "America/New_York")?.toISOString()).toBe(
      "2026-03-08T12:00:00.000Z"
    )
    expect(nextReminderAt(now, [], "America/New_York")).toBeNull()
    expect(nextReminderAt(now, ["8am"], "America/New_York")).toBeNull()
  })

  test("a full refresh is planned for the reminder's local day after DST", () => {
    const runAt = nextReminderAt(new Date("2026-03-08T03:30:00Z"), ["08:00", "22:00"], "America/New_York")!
    const next = planNext({
      coverage: { live: true, lastOkTo: "2026-03-08T03:00:00Z" },
      lastFullRefreshDay: "2026-03-07",
      lastMentionId: null,
      sync,
      timeZone: "America/New_York",
      runAt,
    })
    expect(next).toMatchObject({ type: "full", from: new Date(runAt.getTime() - 7 * DAY).toISOString(), mentionsSinceId: null })
  })
})

describe("isFullRefresh", () => {
  const window = (days: number) => ({ from: ago(days * DAY), to: now.toISOString() })
  test("allows up to a day short of the full span", () => {
    expect(isFullRefresh(window(7), 7)).toBe(true)
    expect(isFullRefresh(window(6.2), 7)).toBe(true)
    expect(isFullRefresh(window(5), 7)).toBe(false)
    expect(isFullRefresh(window(1), 7)).toBe(false)
  })
})
