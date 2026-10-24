"use client"

import { ChartColumnIcon, ChartSplineIcon } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, type ReactNode } from "react"

import { endTouchHover } from "@/components/dashboard/chart-hover-sync"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"

export const CHART_TYPES = ["curve", "bar"] as const
export type ChartType = (typeof CHART_TYPES)[number]

const OPTIONS: Record<ChartType, { label: string; icon: typeof ChartSplineIcon }> = {
  curve: { label: "Curve", icon: ChartSplineIcon },
  bar: { label: "Bar", icon: ChartColumnIcon },
}

/**
 * A chart's curve / bar choice, kept in the URL (`?impChart=bar`) so it
 * survives reloads and shares with the date range. Writes go through
 * history.replaceState, which Next syncs into useSearchParams without a
 * server round trip; every other param (from, to, ...) is kept.
 */
export function useChartType(param: string): [ChartType, (next: ChartType) => void] {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const value: ChartType = searchParams.get(param) === "bar" ? "bar" : "curve"
  const setValue = useCallback(
    (next: ChartType) => {
      const params = new URLSearchParams(window.location.search)
      params.set(param, next)
      window.history.replaceState(null, "", `${pathname}?${params}${window.location.hash}`)
    },
    [param, pathname]
  )
  return [value, setValue]
}

/** Small Curve / Bar picker for a chart card header. */
export function ChartTypeSelect({
  value,
  onValueChange,
  label = "Chart type",
  className,
}: {
  value: ChartType
  onValueChange: (next: ChartType) => void
  label?: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as ChartType)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("w-auto min-w-28 shrink-0 whitespace-nowrap", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="min-w-28">
        {CHART_TYPES.map((type) => {
          const { label: text, icon: Icon } = OPTIONS[type]
          return (
            <SelectItem key={type} value={type}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {text}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

const LEAVE_MS = 200

/**
 * Crossfades between the curve and bar renderings in one fixed-size box:
 * the new chart mounts (and plays its own draw-in) while the old one fades
 * out on top of nothing, then unmounts. Reduced motion swaps instantly.
 */
export function ChartCrossfade({
  type,
  className,
  children,
}: {
  type: ChartType
  className?: string
  children: (type: ChartType) => ReactNode
}) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(type)
  const [leaving, setLeaving] = useState<ChartType | null>(null)

  if (type !== shown) {
    setShown(type)
    setLeaving(reduceMotion ? null : shown)
  }

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => clearTimeout(t)
  }, [leaving])

  return (
    <div
      className={cn("t-chart-xfade relative", className)}
      onTouchEnd={(e) => endTouchHover(e.currentTarget)}
      onTouchCancel={(e) => endTouchHover(e.currentTarget)}
    >
      {CHART_TYPES.filter((t) => t === type || t === leaving).map((t) => (
        <div
          key={t}
          className="t-chart-layer absolute inset-0"
          data-state={t === type ? "in" : "out"}
          aria-hidden={t === type ? undefined : true}
          inert={t !== type}
        >
          {children(t)}
        </div>
      ))}
    </div>
  )
}
