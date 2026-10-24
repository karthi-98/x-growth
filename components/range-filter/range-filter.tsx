import { BanknoteIcon, CalendarIcon } from "lucide-react"

import { DateRangePicker } from "@/components/range-filter/date-range-picker"
import { PayPeriodSelect } from "@/components/range-filter/pay-period-select"
import { connection } from "next/server"

import { Button } from "@/components/ui/button"
import { istDateKey } from "@/lib/dates"
import { listPayPeriods } from "@/lib/pay-periods"
import { getDataBounds } from "@/lib/queries"
import { parseRange } from "@/lib/range"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Mobile: pay period then date range, stacked full width. sm+: one row. */
export async function RangeFilter({ searchParams }: { searchParams: SearchParams }) {
  const [params, bounds] = await Promise.all([searchParams, getDataBounds()])
  await connection() // "today" (IST) must be read per request
  const today = istDateKey()
  const { from, to } = parseRange(params, today)
  const minKey = bounds?.min ?? from
  return (
    <div className="grid gap-2 sm:flex sm:items-center">
      <PayPeriodSelect
        periods={listPayPeriods(today, minKey)}
        from={from}
        to={to}
        today={today}
        dataMax={bounds?.max ?? null}
      />
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
