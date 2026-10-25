import { describe, expect, test } from "bun:test"

import { normalizeTimeZone, timeZoneOptions, validateGeneralSettings } from "@/components/settings/general-validate"

const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null })

describe("validateGeneralSettings", () => {
  test("accepts a full form and normalizes it", () => {
    const r = validateGeneralSettings(
      form({
        handle: "@designwkarthick",
        timeZone: "america/new_york",
        payPeriodEnabled: "on",
        anchor: "2026-10-21",
        days: "14",
        payoutOffsetDays: "3",
      })
    )
    expect(r).toEqual({
      ok: true,
      patch: {
        handle: "designwkarthick",
        timeZone: "America/New_York",
        payPeriod: { anchor: "2026-10-21", days: 14, payoutOffsetDays: 3 },
      },
    })
  })

  test("pay periods off saves null and ignores their fields", () => {
    const r = validateGeneralSettings(form({ handle: "", timeZone: "UTC", payPeriodEnabled: "off", days: "x" }))
    expect(r).toEqual({ ok: true, patch: { handle: null, timeZone: "UTC", payPeriod: null } })
  })

  test("reports each bad field", () => {
    const r = validateGeneralSettings(
      form({
        handle: "not a handle!",
        timeZone: "Mars/Olympus_Mons",
        payPeriodEnabled: "on",
        anchor: "2026-02-30",
        days: "0",
        payoutOffsetDays: "1.5",
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["anchor", "days", "handle", "payoutOffsetDays", "timeZone"])
  })

  test("timezone names keep the runtime's spelling", () => {
    expect(normalizeTimeZone("asia/kolkata")).toBe("Asia/Kolkata")
    expect(normalizeTimeZone("utc")).toBe("UTC")
    // Node's ICU still lists and reports some zones under their old names.
    expect(normalizeTimeZone("Asia/Calcutta")).toBe("Asia/Kolkata")
    expect(normalizeTimeZone("asia/kolkata", ["Asia/Calcutta"])).toBe("Asia/Kolkata")
    expect(normalizeTimeZone("europe/kiev")).toBe("Europe/Kyiv")
    expect(normalizeTimeZone("")).toBeNull()
    expect(normalizeTimeZone("Nowhere/Land")).toBeNull()
  })

  test("picker options use current names and include UTC", () => {
    expect(timeZoneOptions(["Asia/Calcutta", "Europe/Kiev", "America/New_York"])).toEqual([
      "America/New_York",
      "Asia/Kolkata",
      "Europe/Kyiv",
      "UTC",
    ])
  })
})
