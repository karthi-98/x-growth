import { isValidTimeZone } from "@/lib/dates"
import { isDateKey } from "@/lib/range"
import type { AppSettings } from "@/lib/settings"

/*
 * Validation for the General settings form, shared by the server action
 * (the authority) and the client form (instant feedback). Pure.
 */

export type GeneralField = "handle" | "timeZone" | "anchor" | "days" | "payoutOffsetDays"
export type GeneralErrors = Partial<Record<GeneralField, string>>

export type GeneralFormState = {
  status: "idle" | "saved" | "error"
  errors: GeneralErrors
  /** Bumped on each save so the form can announce it again. */
  savedAt?: number
  /** What was stored, normalized (e.g. "@Me" -> "Me", "utc" -> "UTC"). */
  saved?: { handle: string | null; timeZone: string }
}

export const PAY_PERIOD_LIMITS = { days: { min: 1, max: 90 }, payoutOffsetDays: { min: 0, max: 60 } } as const

type Input = { get(name: string): FormDataEntryValue | null }
type Patch = Pick<AppSettings, "handle" | "timeZone" | "payPeriod">

const text = (input: Input, name: string) => {
  const v = input.get(name)
  return typeof v === "string" ? v.trim() : ""
}

/**
 * Renamed IANA zones that older ICU builds (Node's included) still list and
 * report under the old name. Every runtime accepts the current name.
 */
const LEGACY_ZONES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
}

/** Zone names for the picker: the runtime's list under current names, plus UTC. */
export function timeZoneOptions(list: readonly string[] = Intl.supportedValuesOf("timeZone")): string[] {
  return [...new Set([...list.map((z) => LEGACY_ZONES[z] ?? z), "UTC"])].sort()
}

/** The zone's current, properly cased name ("asia/calcutta" -> "Asia/Kolkata"), or null if unknown. */
export function normalizeTimeZone(value: string, known: readonly string[] = timeZoneOptions()) {
  const tz = value.trim()
  if (!tz || !isValidTimeZone(tz)) return null
  const lower = tz.toLowerCase()
  const renamed = Object.keys(LEGACY_ZONES).find((z) => z.toLowerCase() === lower)
  if (renamed) return LEGACY_ZONES[renamed]
  return timeZoneOptions(known).find((z) => z.toLowerCase() === lower) ?? tz
}

function wholeNumber(raw: string, { min, max }: { min: number; max: number }): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return n >= min && n <= max ? n : null
}

export function validateGeneralSettings(
  input: Input
): { ok: true; patch: Patch } | { ok: false; errors: GeneralErrors } {
  const errors: GeneralErrors = {}

  const handleRaw = text(input, "handle").replace(/^@/, "")
  if (handleRaw && !/^[A-Za-z0-9_]{1,15}$/.test(handleRaw)) {
    errors.handle = "Use up to 15 letters, numbers or underscores."
  }

  const timeZone = normalizeTimeZone(text(input, "timeZone"))
  if (!timeZone) errors.timeZone = "Pick a timezone from the list, e.g. Asia/Kolkata or America/New_York."

  let payPeriod: Patch["payPeriod"] = null
  if (text(input, "payPeriodEnabled") === "on") {
    const anchor = text(input, "anchor")
    const days = wholeNumber(text(input, "days"), PAY_PERIOD_LIMITS.days)
    const payoutOffsetDays = wholeNumber(text(input, "payoutOffsetDays"), PAY_PERIOD_LIMITS.payoutOffsetDays)
    if (!isDateKey(anchor)) errors.anchor = "Pick the first day of any one pay period."
    if (days === null) errors.days = `Enter a whole number of days from ${PAY_PERIOD_LIMITS.days.min} to ${PAY_PERIOD_LIMITS.days.max}.`
    if (payoutOffsetDays === null) {
      errors.payoutOffsetDays = `Enter a whole number of days from ${PAY_PERIOD_LIMITS.payoutOffsetDays.min} to ${PAY_PERIOD_LIMITS.payoutOffsetDays.max}.`
    }
    if (isDateKey(anchor) && days !== null && payoutOffsetDays !== null) {
      payPeriod = { anchor, days, payoutOffsetDays }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, patch: { handle: handleRaw || null, timeZone: timeZone!, payPeriod } }
}
