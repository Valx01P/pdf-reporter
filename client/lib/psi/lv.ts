// Phase 1/3b — the PSI three-question Likely-Voter model. Computed on the raw,
// unweighted sample so the propensity reflects respondents' answers, not any
// weighting decision. LV_raw is the geometric mean of the Q3/Q4/Q5 weights;
// P(vote) is a logistic calibration whose midpoint µ is solved so the mean
// P(vote) matches the projected turnout rate, with steepness k modulated by the
// Q2 vote-history bucket.

import type { DerivedRespondent, LvConfig, LvResult } from "./types"

function logistic(k: number, raw: number, mu: number): number {
  return 1 / (1 + Math.exp(-k * (raw - mu)))
}

function weightFor(map: Record<string, number>, response: string): number {
  if (response && response in map) return map[response]
  return 0.5 // neutral fallback for blank / unmapped responses
}

export function scoreLv(derived: DerivedRespondent[], cfg: LvConfig): LvResult {
  const n = derived.length
  const raw = new Array(n).fill(0)
  const kArr = new Array(n).fill(12)

  for (let idx = 0; idx < n; idx++) {
    const d = derived[idx]
    const w3 = weightFor(cfg.q3Map, d.q3)
    const w4 = weightFor(cfg.q4Map, d.q4)
    const w5 = weightFor(cfg.q5Map, d.q5)
    raw[idx] = Math.cbrt(w3 * w4 * w5)
    kArr[idx] = cfg.k[d.historyBucket]
  }

  // Solve µ so mean P(vote) == projected turnout (60-iteration binary search).
  // P decreases monotonically in µ, so bisection is well-posed.
  const target = cfg.projectedTurnout
  let lo = -0.5
  let hi = 1.5
  let mu = 0.5
  for (let it = 0; it < 60; it++) {
    mu = (lo + hi) / 2
    let mean = 0
    for (let i = 0; i < n; i++) mean += logistic(kArr[i], raw[i], mu)
    mean = n ? mean / n : 0
    if (mean > target) lo = mu
    else hi = mu
  }

  const pvote = new Array(n).fill(0)
  let meanPvote = 0
  let highCount = 0
  let lowCount = 0
  for (let i = 0; i < n; i++) {
    const p = logistic(kArr[i], raw[i], mu)
    pvote[i] = p
    meanPvote += p
    if (p >= 0.9) highCount++
    if (p <= 0.1) lowCount++
  }
  meanPvote = n ? meanPvote / n : 0

  const buckets = { consistent: 0, occasional: 0, new: 0 }
  for (const d of derived) buckets[d.historyBucket]++

  return {
    raw,
    pvote,
    mu,
    meanPvote,
    highCount,
    lowCount,
    buckets,
    rawHist: histogram01(raw),
    pvoteHist: histogram01(pvote),
  }
}

function histogram01(values: number[]): { label: string; count: number }[] {
  const bins = Array.from({ length: 10 }, (_, b) => ({
    label: `${(b / 10).toFixed(1)}–${((b + 1) / 10).toFixed(1)}`,
    count: 0,
  }))
  for (const v of values) {
    const b = Math.min(9, Math.max(0, Math.floor(v * 10)))
    bins[b].count++
  }
  return bins
}
