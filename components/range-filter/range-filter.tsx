import { BanknoteIcon, CalendarIcon } from "lucide-react"

import { DateRangePicker } from "@/components/range-filter/date-range-picker"
import { PayPeriodSelect } from "@/components/range-filter/pay-period-select"

import { Button } from "@/components/ui/button"
import { dateKeyIn } from "@/lib/dates"
import { getSettings } from "@/lib/get-settings"
import { listPayPeriods } from "@/lib/pay-periods"
import { getDataBounds } from "@/lib/queries"
import { parseRange } from "@/lib/range"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Mobile: pay period then date range, stacked full width. sm+: one row.
 * Dates are in the settings timezone; the pay-period picker is hidden while
 * pay periods are off in Settings.
 */
export async function RangeFilter({ searchParams }: { searchParams: SearchParams }) {
  const [params, settings] = await Promise.all([searchParams, getSettings()])
  const bounds = await getDataBounds(settings.timeZone)
  // getSettings() awaits connection(), so "today" is read per request.
  const today = dateKeyIn(new Date(), settings.timeZone)
  const { from, to } = parseRange(params, today)
  const minKey = bounds?.min ?? from
  const { payPeriod } = settings
  return (
    <div className="grid gap-2 sm:flex sm:items-center">
      {payPeriod ? (
        <PayPeriodSelect
          periods={listPayPeriods(today, minKey, payPeriod)}
          payPeriod={payPeriod}
          from={from}
          to={to}
          today={today}
          dataMax={bounds?.max ?? null}
        />
      ) : null}
      <DateRangePicker from={from} to={to} minKey={minKey} maxKey={today} />
    </div>
  )
}

export function RangeFilterFallback() {
  return (
    <div className="grid gap-2 sm:flex sm:items-center">
      <Button variant="outline" className="w-full justify-start sm:w-auto" disabled>
        <BanknoteIcon data-icon="inline-start" />
        Pay period
      </Button>
      <Button variant="outline" className="w-full justify-start sm:w-auto" disabled>
        <CalendarIcon data-icon="inline-start" />
        Loading range
      </Button>
    </div>
  )
}
