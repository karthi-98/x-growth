// Ported from the transitions.dev "Donut chart" transition
// (.agents/skills/transitions-dev/35-donut-chart.md): ring sectors with even
// gaps and rounded corners that morph to new values. Angles run clockwise
// from the top.

// The CSS cubic-bezier, for the JS tween.
function bezier(x1: number, y1: number, x2: number, y2: number) {
  return (t: number) => {
    let lo = 0,
      hi = 1,
      u = t
    for (let i = 0; i < 24; i++) {
      u = (lo + hi) / 2
      const x =
        3 * u * (1 - u) * (1 - u) * x1 + 3 * u * u * (1 - u) * x2 + u * u * u
      if (x < t) lo = u
      else hi = u
    }
    return (
      3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u * u * u
    )
  }
}

// CSS times in ms; the CSS pipeline may minify "400ms" to ".4s".
function toMs(value: string) {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return 0
  return /ms$/i.test(value) ? n : /s$/i.test(value) ? n * 1000 : n
}

function easeOf(value: string) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(value)
  if (!m) return (t: number) => t
  const [a, b, c, d] = m[1].split(",").map(parseFloat)
  return bezier(a, b, c, d)
}

// One ring sector from angle a0 to a1, inset by the corner radius (the
// round-joined stroke adds it back) and by half the gap measured straight
// across, so both gap edges stay parallel.
function ringPath(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number,
  gap: number,
  cr: number
) {
  const Ro = ro - cr,
    Ri = ri + cr,
    h = gap / 2 + cr
  if (Ro <= Ri) return ""
  const dO = Math.asin(Math.min(1, h / Ro)),
    dI = Math.asin(Math.min(1, h / Ri))
  const o0 = a0 + dO,
    o1 = a1 - dO,
    i0 = a0 + dI,
    i1 = a1 - dI
  if (i1 - i0 <= 0 || o1 - o0 <= 0) return "" // too small to draw
  const pt = (r: number, a: number) => point(cx, cy, r, a)
  const lo = o1 - o0 > Math.PI ? 1 : 0,
    li = i1 - i0 > Math.PI ? 1 : 0
  return (
    "M" + pt(Ro, o0) +
    "A" + Ro + " " + Ro + " 0 " + lo + " 1 " + pt(Ro, o1) +
    "L" + pt(Ri, i1) +
    "A" + Ri + " " + Ri + " 0 " + li + " 0 " + pt(Ri, i0) +
    "Z"
  )
}

function point(cx: number, cy: number, r: number, a: number) {
  return (cx + r * Math.sin(a)).toFixed(3) + " " + (cy - r * Math.cos(a)).toFixed(3)
}

// A plain annular sector with no gap or corner inset: the hit area. A full
// turn is drawn as two half-turn rings so the arcs never degenerate.
function sectorPath(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  a0: number,
  a1: number
) {
  const pt = (r: number, a: number) => point(cx, cy, r, a)
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const am = a0 + Math.PI
    return (
      "M" + pt(ro, a0) +
      "A" + ro + " " + ro + " 0 0 1 " + pt(ro, am) +
      "A" + ro + " " + ro + " 0 0 1 " + pt(ro, a0) + "Z" +
      "M" + pt(ri, a0) +
      "A" + ri + " " + ri + " 0 0 0 " + pt(ri, am) +
      "A" + ri + " " + ri + " 0 0 0 " + pt(ri, a0) + "Z"
    )
  }
  const l = a1 - a0 > Math.PI ? 1 : 0
  return (
    "M" + pt(ro, a0) +
    "A" + ro + " " + ro + " 0 " + l + " 1 " + pt(ro, a1) +
    "L" + pt(ri, a1) +
    "A" + ri + " " + ri + " 0 " + l + " 0 " + pt(ri, a0) +
    "Z"
  )
}

/**
 * Returns `set(values)`: first call draws, later calls tween.
 *
 * The visible arcs (`segments`) never take pointer events: they grow on
 * hover, and a growing shape under a still pointer flips the hit test back
 * and forth. Pointer input goes to `hits` instead: invisible, gap-free
 * sectors at a fixed radius that already covers the grown ring
 * (`--donut-grow`), one for each of the first `opts.hits` segments.
 */
export function donut(
  el: HTMLElement,
  colors: string[],
  opts: { hits?: number } = {}
) {
  // Read tokens off the chart element so it can override the :root values.
  const token = (name: string) =>
    getComputedStyle(el).getPropertyValue(name).trim()
  const svg = el.querySelector("svg")!
  svg.querySelectorAll(".t-donut-seg, .t-donut-hit").forEach((n) => n.remove())
  const vb = svg.viewBox.baseVal,
    cx = vb.width / 2,
    cy = vb.height / 2
  const ro = Math.min(cx, cy),
    ri = ro - (parseFloat(el.dataset.thickness ?? "") || 14)
  const segs = colors.map((color) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
    p.setAttribute("class", "t-donut-seg")
    p.style.fill = color
    p.style.stroke = color
    svg.appendChild(p)
    return p
  })
  // Fixed hit ring: from the resting inner edge out past the grown outer
  // edge, so neither edge moves under the pointer when a segment grows.
  const grow = parseFloat(token("--donut-grow")) || 1
  const hro = ro * grow + 1,
    hri = ri - 1
  const hits = colors.slice(0, opts.hits ?? colors.length).map((_, k) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
    p.setAttribute("class", "t-donut-hit")
    p.dataset.index = String(k)
    svg.appendChild(p) // after every visual arc, so hits sit on top
    return p
  })
  let current: number[] | null = null,
    shown: number[] | null = null,
    raf = 0

  function draw(values: number[]) {
    const total = values.reduce((a, b) => a + b, 0) || 1
    const gap = parseFloat(token("--chart-gap")) || 0
    const cr = parseFloat(token("--chart-corner")) || 0
    let a = 0
    values.forEach((v, k) => {
      const span = (v / total) * Math.PI * 2
      segs[k].setAttribute("d", ringPath(cx, cy, ro, ri, a, a + span, gap, cr))
      segs[k].style.strokeWidth = String(2 * cr)
      // Hits run edge to edge (gaps included) and overlap the next one
      // slightly, so crossing a boundary goes straight from one to the next.
      hits[k]?.setAttribute(
        "d",
        span > 0 ? sectorPath(cx, cy, hro, hri, a, a + span + 0.004) : ""
      )
      a += span
    })
  }

  /**
   * Draws `values`, tweening from the last set. `opts` names the CSS
   * custom properties for this tween's duration and easing (defaults:
   * --chart-morph-dur / --chart-morph-ease).
   */
  function set(values: number[], opts?: { dur?: string; ease?: string }) {
    cancelAnimationFrame(raf)
    // Start from what is on screen, even mid-tween.
    const from = shown ?? current,
      to = values.slice()
    current = to
    const dur =
      toMs(token(opts?.dur ?? "--chart-morph-dur")) ||
      toMs(token("--chart-morph-dur"))
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!from || from.length !== to.length || !dur || reduce) {
      shown = to
      draw(to)
      return
    }
    const ease = easeOf(token(opts?.ease ?? "--chart-morph-ease"))
    const t0 = performance.now()
    ;(function step(now: number) {
      const t = Math.min(1, (now - t0) / dur),
        e = ease(t)
      shown = from.map((f, k) => f + (to[k] - f) * e)
      draw(shown)
      if (t < 1) raf = requestAnimationFrame(step)
    })(t0)
  }
  return {
    set,
    segments: segs,
    hits,
    destroy: () => cancelAnimationFrame(raf),
  }
}
