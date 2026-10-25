"use client"

import { CalendarIcon } from "lucide-react"
import { useState } from "react"
import type { DateRange } from "react-day-picker"

import { useFilterTransition } from "@/components/range-filter/filter-transition"
import { useRangeNavigate } from "@/components/range-filter/use-range-navigate"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMediaQuery } from "@/hooks/use-media-query"
import { formatRangeLabel } from "@/lib/format"
import { DEFAULT_RANGE_DAYS, lastDays, type DateRangeKeys } from "@/lib/range"

// Calendar days are plain local Date objects built from date keys (in the
// settings timezone), so the picker never shifts a day whatever the
// browser's time zone.
const pad = (n: number) => String(n).padStart(2, "0")
const keyToDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const dateToKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const monthStart = (d: Date, offset = 0) =>
  new Date(d.getFullYear(), d.getMonth() + offset, 1)

type Preset = { value: string; label: string; range: DateRangeKeys }

export function DateRangePicker({
  from,
  to,
  minKey,
  maxKey,
}: {
  from: string
  to: string
  /** First date with stored data (settings timezone). */
  minKey: string
  /** Last selectable date: today in the settings timezone. */
  maxKey: string
}) {
  const navigateRange = useRangeNavigate()
  const { isPending } = useFilterTransition()
  const isDesktop = useMediaQuery("(min-width: 768px)", true)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()
  const [pickingEnd, setPickingEnd] = useState(false)
  const [month, setMonth] = useState<Date>(() => keyToDate(to))

  const defaultRange = lastDays(DEFAULT_RANGE_DAYS, maxKey)
  const presets: Preset[] = [
    { value: "7", label: "Last 7 days", range: lastDays(7, maxKey) },
    { value: "14", label: "Last 14 days", range: lastDays(14, maxKey) },
    { value: "30", label: "Last 30 days", range: defaultRange },
    { value: "all", label: "All data", range: { from: minKey, to: maxKey } },
  ]
  const active = presets.find((p) => p.range.from === from && p.range.to === to)

  function navigate(range: DateRangeKeys) {
    const isDefault = range.from === defaultRange.from && range.to === defaultRange.to
    setOpen(false)
    navigateRange(range, { isDefault })
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    setDraft({ from: keyToDate(from), to: keyToDate(to) })
    setPickingEnd(false)
    // Two months on desktop end on the range's last month.
    setMonth(monthStart(keyToDate(to), isDesktop ? -1 : 0))
  }

  // First click starts a range, second click completes and applies it.
  function onDayClick(day: Date) {
    if (!pickingEnd || !draft?.from) {
      setDraft({ from: day, to: undefined })
      setPickingEnd(true)
      return
    }
    const [a, b] = day < draft.from ? [day, draft.from] : [draft.from, day]
    setDraft({ from: a, to: b })
    setPickingEnd(false)
    navigate({ from: dateToKey(a), to: dateToKey(b) })
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start tabular-nums sm:w-auto"
          aria-label={`Date range: ${formatRangeLabel(from, to)}`}
          data-pending={isPending || undefined}
        >
          <CalendarIcon data-icon="inline-start" />
          {formatRangeLabel(from, to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={isDesktop ? "end" : "start"}
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex flex-col md:flex-row">
          <ToggleGroup
            type="single"
            size="sm"
            spacing={1}
            orientation={isDesktop ? "vertical" : "horizontal"}
            value={active?.value ?? ""}
            onValueChange={(value) => {
              const preset = presets.find((p) => p.value === value)
              if (preset) navigate(preset.range)
            }}
            className="grid w-full grid-cols-2 p-2 md:flex md:w-36"
            aria-label="Preset ranges"
          >
            {presets.map((p) => (
              <ToggleGroupItem key={p.value} value={p.value} className="justify-start">
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator orientation={isDesktop ? "vertical" : "horizontal"} className="md:h-auto" />
          <div className="flex flex-col">
            <Calendar
              mode="range"
              numberOfMonths={isDesktop ? 2 : 1}
              selected={draft}
              onSelect={(_range, day) => onDayClick(day)}
              month={month}
              onMonthChange={setMonth}
              startMonth={keyToDate(minKey)}
              endMonth={keyToDate(maxKey)}
              disabled={[{ before: keyToDate(minKey) }, { after: keyToDate(maxKey) }]}
              weekStartsOn={1}
              showOutsideDays={false}
              className="mx-auto [--cell-size:--spacing(10)] md:[--cell-size:--spacing(8)]"
            />
            <Separator />
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {pickingEnd ? "Now pick an end date" : "Pick a start date"}
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!active && active.value === "30"}
                onClick={() => navigate(defaultRange)}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
