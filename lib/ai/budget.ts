import { count, gte } from "drizzle-orm"

import { dateKeyIn, zonedDayStartUtc } from "@/lib/dates"
import { db } from "@/lib/db/client"
import { aiGenerations } from "@/lib/db/schema"
import { readSettings } from "@/lib/settings"
import { spendSince } from "@/lib/spend"

/** UTC ISO instant of the 1st of this month, 00:00 in `timeZone`. */
export function monthStartUtc(timeZone: string, now: Date = new Date()): string {
  const key = `${dateKeyIn(now, timeZone).slice(0, 8)}01`
  return zonedDayStartUtc(key, timeZone)
}

export type MonthSpend = {
  sinceIso: string
  /** Estimated USD this month by provider (spend_ledger). */
  ai: number
  x: number
  generations: number
  capUsd: number | null
}

/** This month's spend (user's timezone) and the optional monthly cap. */
export async function monthSpend(now: Date = new Date()): Promise<MonthSpend> {
  const settings = await readSettings()
  const sinceIso = monthStartUtc(settings.timeZone, now)
  const [spend, [gen]] = await Promise.all([
    spendSince(sinceIso),
    db.select({ n: count() }).from(aiGenerations).where(gte(aiGenerations.createdAt, sinceIso)),
  ])
  return { sinceIso, ai: spend.ai, x: spend.x, generations: gen?.n ?? 0, capUsd: settings.monthlySpendCapUsd }
}

/** True when a monthly cap is set and X + AI spend already reached it. */
export const overCap = (m: MonthSpend) => m.capUsd !== null && m.ai + m.x >= m.capUsd
