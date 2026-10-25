/** Linear-interpolated quantile (0-1) of an ascending array; null when empty. */
export function quantileSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Median of any numbers; null when empty. */
export function median(values: number[]): number | null {
  return quantileSorted([...values].sort((a, b) => a - b), 0.5)
}
