import { addDays } from "@/lib/dates"
import { formatDayKey } from "@/lib/format"
import type { DateRangeKeys } from "@/lib/range"
import type { PayPeriodSettings } from "@/lib/settings"

/**
 * X creator pay periods (Original Content Rewards), as dates in the settings
 * timezone. The anchor, length and payout offset come from
 * `settings.payPeriod`; null there turns the feature off.
 *
 * The defaults (lib/settings.ts) were confirmed by Thor (24 Oct 2026):
 * periods run Wednesday to Tuesday, 14 days, and the current one is
 * Wed 21 Oct - Tue 3 Nov 2026, paid out Fri 6 Nov (3 days after it ends).
 *
 * Background (X publishes payout Fridays but not the earnings windows):
 * - https://xitter.cf/XCreators/article/2085835082166653393 (X announcement:
 *   payouts every two weeks; Revenue Sharing ended 7 Sep 2026)
 * - https://climbx.so/blog/how-x-payouts-work (paid 25 Sep, 9 Oct 2026)
 * - https://payoutwall.com/how-it-works (Wed-Tue windows, Tuesday cutoff)
 */

export type PayPeriod = DateRangeKeys & { isCurrent: boolean }

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000)

/** Period length in whole days, at least 1 (guards a hand-edited setting). */
const lengthOf = (pp: PayPeriodSettings) => Math.max(1, Math.floor(pp.days) || 1)

/** The pay period (inclusive dates) that contains `key`. */
export function payPeriodFor(key: string, pp: PayPeriodSettings): DateRangeKeys {
  const days = lengthOf(pp)
  const n = Math.floor((dayNumber(key) - dayNumber(pp.anchor)) / days)
  const from = addDays(pp.anchor, n * days)
  return { from, to: addDays(from, days - 1) }
}

/**
 * Pay periods newest first: the current one (containing `today`, which may
 * end after today) back to the one containing `dataStart`.
 */
export function listPayPeriods(today: string, dataStart: string, pp: PayPeriodSettings): PayPeriod[] {
  const days = lengthOf(pp)
  const current = payPeriodFor(today, pp).from
  const oldest = payPeriodFor(dataStart < today ? dataStart : today, pp).from
  const periods: PayPeriod[] = []
  for (let from = current; from >= oldest; from = addDays(from, -days)) {
    periods.push({ from, to: addDays(from, days - 1), isCurrent: from === current })
  }
  return periods
}

/**
 * The range to query for a period: `to` clamped to today and to the last
 * date with data (never before the period's start). Labels keep the full period.
 */
export function payPeriodQueryRange(
  period: DateRangeKeys,
  today: string,
  dataMax?: string | null
): DateRangeKeys {
  let to = period.to
  if (today < to) to = today
  if (dataMax && dataMax < to) to = dataMax
  if (to < period.from) to = period.from
  return { from: period.from, to }
}

/** The period a {from, to} range selects (full or clamped), or null for a custom range. */
export function matchPayPeriod(
  range: DateRangeKeys,
  periods: PayPeriod[],
  today: string,
  dataMax?: string | null
): PayPeriod | null {
  return (
    periods.find((p) => {
      if (range.from !== p.from) return false
      return range.to === p.to || range.to === payPeriodQueryRange(p, today, dataMax).to
    }) ?? null
  )
}

/** Payout day for a period (date key). */
export function payoutDate(period: DateRangeKeys, pp: PayPeriodSettings): string {
  return addDays(period.to, Math.max(0, Math.floor(pp.payoutOffsetDays) || 0))
}

/** "Current: 21 Oct \u2013 3 Nov \u00b7 paid 6 Nov" or "7 Oct \u2013 20 Oct \u00b7 paid 23 Oct". */
export function payPeriodLabel(period: PayPeriod, pp: PayPeriodSettings): string {
  const range = `${formatDayKey(period.from)} \u2013 ${formatDayKey(period.to)}`
  const label = `${range} \u00b7 paid ${formatDayKey(payoutDate(period, pp))}`
  return period.isCurrent ? `Current: ${label}` : label
}

/** "21 Oct \u2013 3 Nov". */
export function payPeriodRangeLabel(period: DateRangeKeys): string {
  return `${formatDayKey(period.from)} \u2013 ${formatDayKey(period.to)}`
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })

/** "Paid Fri 23 Oct" once the payout day has passed (by `today`), else "Pays Fri 6 Nov". */
export function payoutLabel(
  period: DateRangeKeys,
  today: string,
  pp: PayPeriodSettings
): { paid: boolean; text: string } {
  const day = payoutDate(period, pp)
  const paid = day <= today
  const when = `${weekday.format(new Date(`${day}T00:00:00Z`))} ${formatDayKey(day)}`
  return { paid, text: `${paid ? "Paid" : "Pays"} ${when}` }
}

/**
 * True when a range is a still-running pay period: it ends today and sits
 * inside the current pay period, which ends after today. Always false when
 * pay periods are off (`pp` null).
 */
export function isRangeInProgress(
  range: DateRangeKeys,
  today: string,
  pp: PayPeriodSettings | null
): boolean {
  if (!pp) return false
  const current = payPeriodFor(today, pp)
  return (
    range.to === today &&
    current.to > today &&
    range.from >= current.from &&
    range.to <= current.to
  )
}
