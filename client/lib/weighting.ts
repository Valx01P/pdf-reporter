// Iterative proportional fitting (raking) to weight respondents to target
// marginal distributions per demographic dimension. Marginals are objects
// keyed by category -> target share (0..1). Mirrors the CentPoll weighting
// engine: weights clipped to [0.25, 4.0] and normalised to mean 1.

const MAX_ITERS = 30
const TOLERANCE = 1e-4
const MIN_WEIGHT = 0.25
const MAX_WEIGHT = 4.0

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

// `rows` is an array of opaque records; `valueFor(dim, i)` returns the category
// label for row i on dimension `dim`. `marginals[dim][value]` is the target
// share. Returns a weight per row (mean 1).
export function rake(
  n: number,
  marginals: Record<string, Record<string, number>>,
  valueFor: (dim: string, i: number) => string,
): number[] {
  const weights = new Array(n).fill(1)
  const dims = Object.keys(marginals)
  if (!n || !dims.length) return weights

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let maxChange = 0
    for (const dim of dims) {
      const targetShares = marginals[dim]
      const sums: Record<string, number> = {}
      let totalW = 0
      for (let i = 0; i < n; i++) {
        const v = valueFor(dim, i)
        sums[v] = (sums[v] || 0) + weights[i]
        totalW += weights[i]
      }
      for (let i = 0; i < n; i++) {
        const v = valueFor(dim, i)
        const observedShare = (sums[v] || 0) / totalW
        const target = targetShares[v]
        if (target == null || observedShare === 0) continue
        const factor = target / observedShare
        const next = clamp(weights[i] * factor, MIN_WEIGHT, MAX_WEIGHT)
        const delta = Math.abs(next - weights[i])
        if (delta > maxChange) maxChange = delta
        weights[i] = next
      }
    }
    if (maxChange < TOLERANCE) break
  }

  const sum = weights.reduce((a, b) => a + b, 0)
  const norm = sum ? n / sum : 1
  return weights.map((w) => w * norm)
}

// Kish effective sample size: (Σw)² / Σ(w²). Equals n when all weights are 1.
export function effectiveSampleSize(weights: number[]): number {
  if (!weights.length) return 0
  let sum = 0
  let sumSq = 0
  for (const w of weights) {
    sum += w
    sumSq += w * w
  }
  return sumSq ? (sum * sum) / sumSq : weights.length
}
