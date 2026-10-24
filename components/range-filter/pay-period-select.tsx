"use client"

import { CheckCircle2Icon, ChevronDownIcon, WalletIcon } from "lucide-react"
import { Select as SelectPrimitive } from "radix-ui"

import { useFilterTransition } from "@/components/range-filter/filter-transition"
import { useRangeNavigate } from "@/components/range-filter/use-range-navigate"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  matchPayPeriod,
  payoutLabel,
  payPeriodLabel,
  payPeriodQueryRange,
  payPeriodRangeLabel,
  type PayPeriod,
} from "@/lib/pay-periods"

function PeriodItem({
  period,
  today,
  selected,
}: {
  period: PayPeriod
  today: string
  selected: boolean
}) {
  const payout = payoutLabel(period, today)
  return (
    <SelectItem
      value={period.from}
      textValue={payPeriodLabel(period)}
      className="t-period-item gap-3 py-2 pr-2.5 pl-2.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-medium tabular-nums">{payPeriodRangeLabel(period)}</span>
          {/* The selected state is conveyed by aria-selected on the option. */}
          {selected ? (
            <Badge variant="outline" aria-hidden="true" className="t-pill-in">
              Selected
            </Badge>
          ) : null}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          {payout.paid ? <CheckCircle2Icon aria-hidden="true" className="t-paid-icon" /> : null}
          {payout.text}
        </span>
      </span>
    </SelectItem>
  )
}

/**
 * X payout periods. The trigger is the same outline Button as the date
 * picker; it shows "Custom" when the URL range is not a pay period.
 */
export function PayPeriodSelect({
  periods,
  from,
  to,
  today,
  dataMax,
}: {
  periods: PayPeriod[]
  from: string
  to: string
  today: string
  dataMax: string | null
}) {
  const navigate = useRangeNavigate()
  const { isPending } = useFilterTransition()
  const isDesktop = useMediaQuery("(min-width: 768px)", true)

  const match = matchPayPeriod({ from, to }, periods, today, dataMax)
  const value = match ? payPeriodRangeLabel(match) : "Custom"

  return (
    <Select
      value={match?.from ?? ""}
      onValueChange={(next) => {
        const period = periods.find((p) => p.from === next)
        if (period) navigate(payPeriodQueryRange(period, today, dataMax))
      }}
    >
      <SelectPrimitive.Trigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start tabular-nums sm:w-auto"
          aria-label={`Payout period: ${match ? payPeriodLabel(match) : "Custom range"}`}
          data-pending={isPending || undefined}
        >
          <WalletIcon data-icon="inline-start" className="text-muted-foreground" />
          <span className="text-xs font-normal text-muted-foreground">Payout period</span>
          <SelectPrimitive.Value
            placeholder={
              <span key="custom" className="t-value-swap">
                Custom
              </span>
            }
          >
            <span key={value} className="t-value-swap">
              {value}
            </span>
          </SelectPrimitive.Value>
          <ChevronDownIcon data-icon="inline-end" className="t-select-chevron ml-auto text-muted-foreground" />
        </Button>
      </SelectPrimitive.Trigger>
      <SelectContent
        position="popper"
        align={isDesktop ? "end" : "start"}
        className="t-select-content max-h-96 w-(--radix-select-trigger-width) min-w-72 p-1"
      >
        <SelectGroup>
          {periods.map((p) => (
            <PeriodItem key={p.from} period={p} today={today} selected={p.from === match?.from} />
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
