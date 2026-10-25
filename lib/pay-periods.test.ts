import { describe, expect, test } from "bun:test"

import {
  isRangeInProgress,
  listPayPeriods,
  matchPayPeriod,
  payoutDate,
  payoutLabel,
  payPeriodFor,
  payPeriodLabel,
  payPeriodQueryRange,
} from "@/lib/pay-periods"
import type { PayPeriodSettings } from "@/lib/settings"

// Same values as DEFAULT_SETTINGS.payPeriod (lib/settings.ts imports the DB client).
const x: PayPeriodSettings = { anchor: "2026-10-21", days: 14, payoutOffsetDays: 3 }
// Weekly, Monday to Sunday, paid the Thursday after.
const weekly: PayPeriodSettings = { anchor: "2026-01-05", days: 7, payoutOffsetDays: 4 }

describe("X's default two-week periods", () => {
  test("the current period and payout", () => {
    const p = payPeriodFor("2026-10-24", x)
    expect(p).toEqual({ from: "2026-10-21", to: "2026-11-03" })
    expect(payoutDate(p, x)).toBe("2026-11-06")
    expect(payPeriodLabel({ ...p, isCurrent: true }, x)).toBe("Current: 21 Oct – 3 Nov · paid 6 Nov")
  })

  test("days before the anchor step back whole periods", () => {
    expect(payPeriodFor("2026-10-20", x)).toEqual({ from: "2026-10-07", to: "2026-10-20" })
    // Tue 30 Jun closes the period nine steps back.
    expect(payPeriodFor("2026-06-30", x)).toEqual({ from: "2026-06-17", to: "2026-06-30" })
    expect(payPeriodFor("2026-07-01", x)).toEqual({ from: "2026-07-01", to: "2026-07-14" })
  })
})

describe("custom weekly periods", () => {
  test("payPeriodFor finds the Monday-to-Sunday week", () => {
    expect(payPeriodFor("2026-01-05", weekly)).toEqual({ from: "2026-01-05", to: "2026-01-11" })
    expect(payPeriodFor("2026-01-04", weekly)).toEqual({ from: "2025-12-29", to: "2026-01-04" })
    expect(payPeriodFor("2026-10-24", weekly)).toEqual({ from: "2026-10-19", to: "2026-10-25" })
  })

  test("listPayPeriods runs newest first back to the data start", () => {
    const periods = listPayPeriods("2026-10-24", "2026-10-01", weekly)
    expect(periods.map((p) => p.from)).toEqual(["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28"])
    expect(periods.map((p) => p.isCurrent)).toEqual([true, false, false, false])
    expect(periods[3].to).toBe("2026-10-04")
  })

  test("payout labels use the custom offset", () => {
    const current = { from: "2026-10-19", to: "2026-10-25" }
    const previous = { from: "2026-10-12", to: "2026-10-18" }
    expect(payoutDate(current, weekly)).toBe("2026-10-29")
    expect(payoutLabel(current, "2026-10-24", weekly)).toEqual({ paid: false, text: "Pays Thu 29 Oct" })
    expect(payoutLabel(previous, "2026-10-24", weekly)).toEqual({ paid: true, text: "Paid Thu 22 Oct" })
  })

  test("a running period is in progress; ranges outside it are not", () => {
    expect(isRangeInProgress({ from: "2026-10-19", to: "2026-10-24" }, "2026-10-24", weekly)).toBe(true)
    expect(isRangeInProgress({ from: "2026-10-21", to: "2026-10-24" }, "2026-10-24", weekly)).toBe(true)
    expect(isRangeInProgress({ from: "2026-10-12", to: "2026-10-24" }, "2026-10-24", weekly)).toBe(false)
    expect(isRangeInProgress({ from: "2026-10-19", to: "2026-10-23" }, "2026-10-24", weekly)).toBe(false)
    // The last day of a period is not "in progress" past today.
    expect(isRangeInProgress({ from: "2026-10-19", to: "2026-10-25" }, "2026-10-25", weekly)).toBe(false)
  })

  test("query ranges clamp to today and data, and still match their period", () => {
    const periods = listPayPeriods("2026-10-24", "2026-10-01", weekly)
    const range = payPeriodQueryRange(periods[0], "2026-10-24", "2026-10-23")
    expect(range).toEqual({ from: "2026-10-19", to: "2026-10-23" })
    expect(matchPayPeriod(range, periods, "2026-10-24", "2026-10-23")?.from).toBe("2026-10-19")
    expect(matchPayPeriod({ from: "2026-10-20", to: "2026-10-23" }, periods, "2026-10-24")).toBeNull()
  })
})

describe("odd settings", () => {
  test("10-day periods anchored mid-month", () => {
    const tenDay: PayPeriodSettings = { anchor: "2026-10-01", days: 10, payoutOffsetDays: 0 }
    expect(payPeriodFor("2026-09-30", tenDay)).toEqual({ from: "2026-09-21", to: "2026-09-30" })
    expect(payPeriodFor("2026-10-11", tenDay)).toEqual({ from: "2026-10-11", to: "2026-10-20" })
    expect(payoutDate({ from: "2026-10-11", to: "2026-10-20" }, tenDay)).toBe("2026-10-20")
  })

  test("a broken length falls back to 1-day periods instead of looping forever", () => {
    const broken: PayPeriodSettings = { anchor: "2026-10-01", days: 0, payoutOffsetDays: 1 }
    expect(payPeriodFor("2026-10-05", broken)).toEqual({ from: "2026-10-05", to: "2026-10-05" })
    expect(listPayPeriods("2026-10-05", "2026-10-03", broken)).toHaveLength(3)
  })

  test("pay periods off: never in progress", () => {
    expect(isRangeInProgress({ from: "2026-10-21", to: "2026-10-24" }, "2026-10-24", null)).toBe(false)
  })
})
