"use client"

import { useState, useSyncExternalStore, type ReactNode } from "react"
import type { MouseHandlerDataParam } from "recharts"

/**
 * Hover sync between the dashboard's daily charts (Impressions, Posts and
 * replies), in either Curve or Bar mode.
 *
 * Live sync is Recharts' own `syncId` with `syncMethod="value"`: the hovered
 * chart broadcasts its active x value (the YYYY-MM-DD date key) and every
 * other chart with the same id shows its cursor, active dot or bar, and
 * tooltip for that same key. Matching by key rather than index keeps the
 * days aligned even if two charts ever cover different spans. A chart that
 * is showing a received hover never re-broadcasts it (Recharts guards that).
 *
 * Recharts only broadcasts when the hovered day changes, so a chart that
 * mounts mid-hover (the Curve/Bar crossfade) would stay blank until the
 * pointer reaches another day. The tiny store below remembers the live
 * hover so a freshly mounted chart can start on that day (`defaultIndex`).
 */

export const DAY_SYNC = { syncId: "xstats-days", syncMethod: "value" } as const

type Hover = { date: string; source: string; session: number }

let hover: Hover | null = null
let sessions = 0
const listeners = new Set<() => void>()

function setHover(next: { date: string; source: string } | null) {
  const prev = hover
  if (!next) {
    if (!prev) return
    hover = null
  } else {
    if (prev && prev.date === next.date && prev.source === next.source) return
    // A new session starts when nothing was hovered or the source changed.
    const session = prev && prev.source === next.source ? prev.session : ++sessions
    hover = { ...next, session }
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Props for a Recharts chart root (AreaChart / BarChart) that join it to the
 * shared day hover. `source` names the card, so its curve and bar
 * renderings count as one chart.
 */
export function daySyncProps(source: string) {
  const track = (state: MouseHandlerDataParam) => {
    const date = state.activeLabel
    if (state.isTooltipActive && date != null) setHover({ date: String(date), source })
  }
  const leave = () => {
    if (hover?.source === source) setHover(null)
  }
  return {
    ...DAY_SYNC,
    onMouseMove: track,
    onTouchMove: track,
    onMouseLeave: leave,
  }
}

/**
 * Renders one chart instance with the day another chart is hovering at the
 * moment it mounts, as a Tooltip `defaultIndex`. The seed lasts only for
 * that hover; once it ends (or the chart is hovered itself, which Recharts
 * prefers anyway) live sync takes over.
 */
export function DaySyncSeed({
  source,
  dates,
  children,
}: {
  source: string
  dates: string[]
  children: (defaultIndex: number | undefined) => ReactNode
}) {
  const [seed] = useState(() =>
    hover && hover.source !== source ? { date: hover.date, session: hover.session } : null
  )
  // Re-renders only when a hover session starts or ends, not per day.
  const session = useSyncExternalStore(
    subscribe,
    () => (hover && hover.source !== source ? hover.session : 0),
    () => 0
  )
  const index = seed && seed.session === session ? dates.indexOf(seed.date) : -1
  return children(index >= 0 ? index : undefined)
}

/**
 * Touch has no hover to leave: end a drag's synced hover when the finger
 * lifts. Recharts clears on mouse leave, so send its wrapper one. (A tap's
 * compatibility mouse events land after this and keep that day shown
 * until the next tap elsewhere, as with a mouse.)
 */
export function endTouchHover(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>(".recharts-wrapper").forEach((w) =>
    w.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))
  )
}