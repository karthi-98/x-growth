"use client"

import "@/app/delta.css"

import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

type Trend = "up" | "down" | "flat"

const TRENDS = ["up", "down", "flat"] as const
const ICONS = { up: TrendingUpIcon, down: TrendingDownIcon, flat: MinusIcon }
const SPOKEN = { up: "Up", down: "Down", flat: "No change" }

const trendOf = (change: number): Trend =>
  change > 0 ? "up" : change < 0 ? "down" : "flat"

/** CSS time in ms; the CSS pipeline may minify "400ms" to ".4s". */
function toMs(value: string, fallback: number) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return /ms$/i.test(value) ? n : /s$/i.test(value) ? n * 1000 : n
}

/** Close to --ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1). */
const easeOut = (t: number) => 1 - (1 - t) ** 4

/**
 * Period-over-period chip for a stat tile: green and up for gains, rose and
 * down for drops, muted with a dash for no change. When `change` updates
 * (range or pay-period switch) the percentage tweens to the new value while
 * the colour and icon cross-fade; reduced motion snaps instantly.
 */
export function DeltaBadge({
  change,
  inProgress = false,
  className,
}: {
  /** Ratio, e.g. 0.12 for +12%. */
  change: number
  /** The current period isn't over yet, so the change is provisional. */
  inProgress?: boolean
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(change)
  const shownRef = useRef(change)
  const trend = trendOf(change)

  useEffect(() => {
    const from = shownRef.current
    if (from === change) return
    const dur = reduceMotion
      ? 0
      : toMs(
          getComputedStyle(document.documentElement).getPropertyValue("--duration-slow"),
          400
        )
    const t0 = performance.now()
    let raf = requestAnimationFrame(function step(now) {
      // rAF's timestamp can precede t0; clamp so the tween never runs backwards.
      const t = dur ? Math.min(1, Math.max(0, (now - t0) / dur)) : 1
      const v = t === 1 ? change : from + (change - from) * easeOut(t)
      shownRef.current = v
      setShown(v)
      if (t < 1) raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [change, reduceMotion])

  return (
    <span
      data-slot="delta-badge"
      data-trend={trend}
      data-in-progress={inProgress || undefined}
      title={inProgress ? "Period in progress" : undefined}
      className={cn(
        "t-delta inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-4xl border pr-2 pl-1.5 text-xs font-medium whitespace-nowrap",
        className
      )}
    >
      <span className="t-delta-icons" aria-hidden="true">
        {TRENDS.map((t) => {
          const Icon = ICONS[t]
          return <Icon key={t} data-on={t === trend} className="t-delta-icon size-3" />
        })}
      </span>
      <span className="sr-only">
        {SPOKEN[trend]}
        {inProgress ? ", period in progress" : ""}{" "}
      </span>
      <span
        data-target={change}
        className="inline-block min-w-[6ch] text-end tabular-nums"
      >
        {formatPercent(shown)}
      </span>
    </span>
  )
}