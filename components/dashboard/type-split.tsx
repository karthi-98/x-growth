"use client"

import "./charts.css"

import { useEffect, useRef, useState } from "react"

import { donut } from "@/lib/donut"
import { formatCompact, formatNumber } from "@/lib/format"
import { POST_TYPE_COLORS, POST_TYPE_META } from "@/lib/post-types"
import type { PostType } from "@/lib/db/schema"
import { cn } from "@/lib/utils"

type DonutChart = ReturnType<typeof donut>

export function TypeSplit({
  data,
}: {
  data: { type: PostType; impressions: number; posts: number }[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<DonutChart | null>(null)
  const drawnRef = useRef<string | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tip, setTip] = useState<{ index: number; show: boolean } | null>(null)
  const total = data.reduce((a, d) => a + d.impressions, 0)
  const typesKey = data.map((d) => d.type).join(",")
  const valuesKey = data.map((d) => d.impressions).join(",")
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0)

  // Build the ring once per set of types. A trailing transparent segment
  // lets it sweep in on mount; later data changes morph it in place.
  useEffect(() => {
    const el = ref.current
    if (!el || !typesKey) return
    const types = typesKey.split(",") as PostType[]
    const chart = donut(
      el,
      [...types.map((t) => POST_TYPE_COLORS[t]), "transparent"],
      { hits: types.length } // no hit area for the mount-sweep filler
    )
    chartRef.current = chart
    // Expose each segment's token so CSS can derive its hover glow.
    types.forEach((t, i) =>
      chart.segments[i].style.setProperty("--seg-color", POST_TYPE_COLORS[t])
    )
    drawnRef.current = null
    // Track the active segment on the ring, from the fixed hit sectors.
    // Moving between neighbours switches directly (pointerout's
    // relatedTarget is the next hit), and only leaving the ring clears it.
    const svg = el.querySelector("svg")!
    const hitIndex = (n: EventTarget | null) =>
      n instanceof SVGElement && n.classList.contains("t-donut-hit")
        ? Number(n.dataset.index)
        : null
    const over = (e: PointerEvent) => {
      const i = hitIndex(e.target)
      if (i === null) return
      setHovered(i)
      setTip({ index: i, show: true })
    }
    const out = (e: PointerEvent) => {
      if (hitIndex(e.target) === null || hitIndex(e.relatedTarget) !== null)
        return
      setHovered(null)
      setTip((t) => (t ? { ...t, show: false } : t))
    }
    svg.addEventListener("pointerover", over)
    svg.addEventListener("pointerout", out)
    return () => {
      svg.removeEventListener("pointerover", over)
      svg.removeEventListener("pointerout", out)
      chart.destroy()
      chartRef.current = null
    }
  }, [typesKey])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || drawnRef.current === valuesKey) return
    const values = valuesKey.split(",").map(Number)
    if (drawnRef.current === null) {
      chart.set([...values.map(() => 0), 1])
      chart.set([...values, 0], {
        dur: "--chart-sweep-dur",
        ease: "--chart-sweep-ease",
      })
    } else {
      chart.set([...values, 0])
    }
    drawnRef.current = valuesKey
  }, [typesKey, valuesKey])

  useEffect(() => {
    chartRef.current?.segments.forEach((seg, i) => {
      seg.classList.toggle("is-dim", hovered !== null && hovered !== i)
      seg.classList.toggle("is-active", hovered === i)
    })
  }, [hovered, typesKey])

  // Follow the pointer without re-rendering: write the transform directly.
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const box = ref.current?.getBoundingClientRect()
    if (!box || !tipRef.current) return
    const x = e.clientX - box.left + 12
    const y = e.clientY - box.top + 12
    tipRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  const focus = hovered !== null ? data[hovered] : undefined
  const tipItem = tip ? data[tip.index] : undefined

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row lg:flex-col xl:flex-row">
      <div
        ref={ref}
        className="t-donut shrink-0"
        data-thickness="16"
        onPointerMove={onPointerMove}
      >
        <svg viewBox="0 0 160 160" aria-hidden="true" />
        <div className="t-donut-center pointer-events-none">
          <span
            key={focus ? `v-${focus.type}` : "v-total"}
            className="t-chart-swap text-xl font-semibold tabular-nums tracking-tight"
          >
            {focus ? `${pct(focus.impressions)}%` : formatCompact(total)}
          </span>
          <span
            key={focus ? `l-${focus.type}` : "l-total"}
            className="t-chart-swap text-xs text-muted-foreground"
          >
            {focus ? POST_TYPE_META[focus.type].plural : "impressions"}
          </span>
        </div>
        <div
          ref={tipRef}
          className="t-donut-tip absolute top-0 left-0 z-10"
          data-show={Boolean(tip?.show && tipItem)}
          aria-hidden="true"
        >
          {tipItem ? (
            <div className="t-donut-tip-inner grid min-w-36 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
              <div className="font-medium">{POST_TYPE_META[tipItem.type].plural}</div>
              <div className="flex w-full items-stretch gap-2">
                <div
                  className="w-1 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: POST_TYPE_COLORS[tipItem.type] }}
                />
                <div className="grid flex-1 gap-1.5 leading-none">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Impressions</span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatNumber(tipItem.impressions)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Posts</span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {formatNumber(tipItem.posts)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ul className="flex w-full flex-col gap-1" aria-label="Impressions by post type">
        {data.map((d, i) => (
          <li
            key={d.type}
            onPointerEnter={() => setHovered(i)}
            onPointerLeave={() => setHovered(null)}
            className={cn(
              "t-legend-row flex items-center gap-3 rounded-md px-2 py-1.5",
              hovered !== null && hovered !== i && "opacity-50"
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: POST_TYPE_COLORS[d.type] }}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{POST_TYPE_META[d.type].plural}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {d.posts} posts
              </span>
            </span>
            <span
              className="text-sm font-medium tabular-nums"
              title={formatNumber(d.impressions)}
            >
              {pct(d.impressions)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
