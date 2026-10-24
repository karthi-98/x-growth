/**
 * Tooltip cursors shared by the dashboard charts. Each is one persistent
 * element positioned with a transform, so CSS (charts.css) can glide it
 * between days instead of jumping.
 */

/** Vertical dashed guide for curve charts. */
export function GlideCursor({ points }: { points?: { x: number; y: number }[] }) {
  if (!points || points.length < 2) return null
  const [top, bottom] = points
  return (
    <g className="t-chart-cursor" style={{ transform: `translateX(${top.x}px)` }}>
      <line x1={0} x2={0} y1={top.y} y2={bottom.y} />
    </g>
  )
}

/** Soft rounded band behind the hovered day for bar charts. */
export function GlideBand({
  x,
  y,
  width,
  height,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
}) {
  if (x == null || y == null || !width || !height) return null
  return (
    <g className="t-chart-band" style={{ transform: `translateX(${x}px)` }}>
      <rect x={0} y={y} width={width} height={height} rx={4} />
    </g>
  )
}
