"use client"

import "./insights.css"

import { useRef, useState } from "react"

import { formatCompact, formatNumber } from "@/lib/format"
import { formatHour, formatHourSpan, type HeatCell, type Heatmap } from "@/lib/insights/heatmap"
import { WEEKDAYS, WEEKDAYS_LONG } from "@/lib/insights/zoned"

const HOURS = Array.from({ length: 24 }, (_, h) => h)
/** Below this container width the CSS transposes the grid (insights.css). */
const TALL_BELOW_PX = 544

function cellLabel(c: HeatCell, minPosts: number) {
  const when = `${WEEKDAYS_LONG[c.weekday]}, ${formatHourSpan(c.hour)}`
  if (c.posts === 0) return `${when}: no posts`
  if (c.median === null) {
    return `${when}: ${c.posts} ${c.posts === 1 ? "post" : "posts"}, too few for a median (needs ${minPosts})`
  }
  return `${when}: median ${formatNumber(Math.round(c.median))} impressions from ${c.posts} posts`
}

/** Legend text for each colour step: "Under 450", "450–900", ..., "2.4K+". */
function stepLabels(thresholds: number[]) {
  if (thresholds.length === 0) return ["All scored hours"]
  return [
    `Under ${formatCompact(thresholds[0])}`,
    ...thresholds.slice(1).map((t, i) => `${formatCompact(thresholds[i])}–${formatCompact(t)}`),
    `${formatCompact(thresholds[thresholds.length - 1])}+`,
  ]
}

/**
 * Weekday x hour grid of median impressions. An ARIA grid with one tab stop:
 * arrow keys move between hours and days (following the on-screen layout,
 * which turns tall on narrow screens), and every cell has a full text label.
 * Hover or focus shows a tooltip.
 */
export function BestTimeHeatmap({ heatmap }: { heatmap: Heatmap }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const { cells, minPosts, thresholds } = heatmap
  const firstBest = heatmap.best[0]
  const [focusIndex, setFocusIndex] = useState(firstBest ? firstBest.weekday * 24 + firstBest.hour : 0)
  const [tip, setTip] = useState<{ index: number; show: boolean } | null>(null)

  function showTip(index: number, target: HTMLElement) {
    const wrap = wrapRef.current
    const tipEl = tipRef.current
    if (!wrap || !tipEl) return
    const box = wrap.getBoundingClientRect()
    const cell = target.getBoundingClientRect()
    setTip({ index, show: true })
    // Place above the cell, kept inside the card horizontally.
    requestAnimationFrame(() => {
      const w = tipEl.offsetWidth
      const h = tipEl.offsetHeight
      const x = Math.min(Math.max(0, cell.left - box.left + cell.width / 2 - w / 2), box.width - w)
      const above = cell.top - box.top - h - 8
      const y = above >= 0 ? above : cell.bottom - box.top + 8
      tipEl.style.transform = `translate3d(${x}px, ${y}px, 0)`
    })
  }

  function move(e: React.KeyboardEvent<HTMLDivElement>) {
    const tall = (wrapRef.current?.clientWidth ?? Infinity) < TALL_BELOW_PX
    let weekday = Math.floor(focusIndex / 24)
    let hour = focusIndex % 24
    const across = (d: number) => (tall ? (weekday = (weekday + d + 7) % 7) : (hour = (hour + d + 24) % 24))
    const down = (d: number) => (tall ? (hour = (hour + d + 24) % 24) : (weekday = (weekday + d + 7) % 7))
    switch (e.key) {
      case "ArrowRight": across(1); break
      case "ArrowLeft": across(-1); break
      case "ArrowDown": down(1); break
      case "ArrowUp": down(-1); break
      case "Home": hour = 0; break
      case "End": hour = 23; break
      case "Escape": setTip((t) => (t ? { ...t, show: false } : t)); return
      default: return
    }
    e.preventDefault()
    const next = weekday * 24 + hour
    setFocusIndex(next)
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)
    el?.focus()
  }

  const tipCell = tip ? cells[tip.index] : undefined
  const labels = stepLabels(thresholds)

  return (
    <div className="flex flex-col gap-4">
      <div ref={wrapRef} className="t-heat-wrap" onPointerLeave={() => setTip((t) => (t ? { ...t, show: false } : t))}>
        <div
          role="grid"
          aria-label="Median impressions by weekday and hour"
          aria-rowcount={8}
          aria-colcount={25}
          className="t-heat text-[11px] text-muted-foreground"
          onKeyDown={move}
        >
          <div role="row" data-slot="heat-row">
            <span role="columnheader" aria-label="Weekday" style={{ gridRow: 1, gridColumn: 1 }} />
            {HOURS.map((h) => (
              <span
                key={h}
                role="columnheader"
                data-slot="heat-hour"
                data-minor={h % 3 !== 0 || undefined}
                className="self-end leading-none tabular-nums"
                style={{ "--col": h + 2 } as React.CSSProperties}
              >
                {formatHour(h)}
              </span>
            ))}
          </div>
          {WEEKDAYS.map((day, weekday) => (
            <div key={day} role="row" data-slot="heat-row">
              <span
                role="rowheader"
                data-slot="heat-day"
                className="self-center leading-none"
                style={{ "--row": weekday + 2 } as React.CSSProperties}
              >
                <span aria-hidden="true">{day}</span>
                <span className="sr-only">{WEEKDAYS_LONG[weekday]}</span>
              </span>
              {HOURS.map((hour) => {
                const index = weekday * 24 + hour
                const c = cells[index]
                return (
                  <div
                    key={hour}
                    role="gridcell"
                    tabIndex={index === focusIndex ? 0 : -1}
                    data-index={index}
                    data-slot="heat-cell"
                    data-level={c.level}
                    data-sparse={(c.posts > 0 && c.median === null) || undefined}
                    data-active={(tip?.show && tip.index === index) || undefined}
                    aria-label={cellLabel(c, minPosts)}
                    className="t-heat-cell"
                    style={{ "--row": weekday + 2, "--col": hour + 2 } as React.CSSProperties}
                    onPointerEnter={(e) => showTip(index, e.currentTarget)}
                    onFocus={(e) => {
                      setFocusIndex(index)
                      showTip(index, e.currentTarget)
                    }}
                    onBlur={() => setTip((t) => (t ? { ...t, show: false } : t))}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div ref={tipRef} className="t-heat-tip" data-show={Boolean(tip?.show && tipCell)} aria-hidden="true">
          {tipCell ? (
            <div className="grid min-w-40 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
              <div className="font-medium">
                {WEEKDAYS[tipCell.weekday]} {formatHourSpan(tipCell.hour)}
              </div>
              {tipCell.median !== null ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Median impressions</span>
                  <span className="font-mono font-medium tabular-nums">{formatNumber(Math.round(tipCell.median))}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Posts</span>
                <span className="font-mono font-medium tabular-nums">{formatNumber(tipCell.posts)}</span>
              </div>
              {tipCell.posts > 0 && tipCell.median === null ? (
                <div className="text-muted-foreground">Too few posts (needs {minPosts})</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Median impressions</span>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Colour scale">
          {labels.map((label, i) => (
            <li key={label} className="flex items-center gap-1.5 tabular-nums">
              <span aria-hidden="true" className="t-heat-cell t-heat-swatch" data-level={i + 1} />
              {label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="t-heat-cell t-heat-swatch" data-level={0} data-sparse />
            Fewer than {minPosts} posts
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="t-heat-cell t-heat-swatch" data-level={0} />
            No posts
          </li>
        </ul>
      </div>
    </div>
  )
}
