import { addDays } from "@/lib/dates"
import { formatDayKey } from "@/lib/format"
import type { DateRangeKeys } from "@/lib/range"

/**
 * X creator pay periods (Original Content Rewards), in IST.
 *
 * Confirmed by Thor (24 Oct 2026): periods run Wednesday to Tuesday, 14 days,
 * and the current one is Wed 21 Oct - Tue 3 Nov 2026, paid out Fri 6 Nov.
 * The payout lands PAYOUT_OFFSET_DAYS after a period ends.
 *
 * Background (X publishes payout Fridays but not the earnings windows):
 * - https://xitter.cf/XCreators/article/2085835082166653393 (X announcement:
 *   payouts every two weeks; Revenue Sharing ended 7 Sep 2026)
 * - https://climbx.so/blog/how-x-payouts-work (paid 25 Sep, 9 Oct 2026)
 * - https://payoutwall.com/how-it-works (Wed-Tue windows, Tuesday cutoff)
 */
/** First day of a known pay period; others step from it by PAY_PERIOD_DAYS. */
export const PAY_PERIOD_ANCHOR = "2026-10-21"
export const PAY_PERIOD_DAYS = 14
/** Payout date = period end + this many days (Tue 3 Nov -> Fri 6 Nov). */
export const PAYOUT_OFFSET_DAYS = 3

export type PayPeriod = DateRangeKeys & { isCurrent: boolean }

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000)

/** The pay period (inclusive IST dates) that contains `key`. */
export function payPeriodFor(key: string): DateRangeKeys {
  const n = Math.floor((dayNumber(key) - dayNumber(PAY_PERIOD_ANCHOR)) / PAY_PERIOD_DAYS)
  const from = addDays(PAY_PERIOD_ANCHOR, n * PAY_PERIOD_DAYS)
  return { from, to: addDays(from, PAY_PERIOD_DAYS - 1) }
}

/**
 * Pay periods newest first: the current one (containing `today`, which may
 * end after today) back to the one containing `dataStart`.
 */
export function listPayPeriods(today: string, dataStart: string): PayPeriod[] {
  const current = payPeriodFor(today).from
  const oldest = payPeriodFor(dataStart < today ? dataStart : today).from
  const periods: PayPeriod[] = []
  for (let from = current; from >= oldest; from = addDays(from, -PAY_PERIOD_DAYS)) {
    periods.push({ from, to: addDays(from, PAY_PERIOD_DAYS - 1), isCurrent: from === current })
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

/** Payout day for a period (IST date key). */
export function payoutDate(period: DateRangeKeys): string {
  return addDays(period.to, PAYOUT_OFFSET_DAYS)
}

/** "Current: 21 Oct \u2013 3 Nov \u00b7 paid 6 Nov" or "7 Oct \u2013 20 Oct \u00b7 paid 23 Oct". */
export function payPeriodLabel(period: PayPeriod): string {
  const range = `${formatDayKey(period.from)} \u2013 ${formatDayKey(period.to)}`
  const label = `${range} \u00b7 paid ${formatDayKey(payoutDate(period))}`
  return period.isCurrent ? `Current: ${label}` : label
}

/** "21 Oct \u2013 3 Nov". */
export function payPeriodRangeLabel(period: DateRangeKeys): string {
  return `${formatDayKey(period.from)} \u2013 ${formatDayKey(period.to)}`
}

const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" })

/** "Paid Fri 23 Oct" once the payout day has passed (IST), else "Pays Fri 6 Nov". */
export function payoutLabel(period: DateRangeKeys, today: string): { paid: boolean; text: string } {
  const day = payoutDate(period)
  const paid = day <= today
  const when = `${weekday.format(new Date(`${day}T00:00:00Z`))} ${formatDayKey(day)}`
  return { paid, text: `${paid ? "Paid" : "Pays"} ${when}` }
}

/**
 * True when a range is a still-running pay period: it ends today (IST) and
 * sits inside the current pay period, which ends after today.
 */
export function isRangeInProgress(range: DateRangeKeys, today: string): boolean {
  const current = payPeriodFor(today)
  return (
    range.to === today &&
    current.to > today &&
    range.from >= current.from &&
    range.to <= current.to
  )
}
