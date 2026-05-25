// Phases 3a/3b — the Wisconsin raking pipeline: cell-collapse safeguard, an
// uncapped sequential IPF rake iterated to convergence (matching usmay.py),
// two-stage recall calibration with a 99th-percentile trim, and the weighted
// diagnostics (DEFF, Kish effective N, SMD). Initializes from uniform (RV) or
// normalized P(vote) (LV).

import type { ConvergenceRound, DerivedRespondent, Diagnostics, DimensionTargets, RakeLog } from "./types"
import { FEC_2024, CPS_DNV_SHARE } from "./constants"
import { cellOf, DIM_MIN_N as MIN_N } from "./cells"

function normalizeMean1(w: number[]): number[] {
  const sum = w.reduce((s, x) => s + x, 0)
  const f = sum ? w.length / sum : 1
  return w.map((x) => x * f)
}

// Build, per dimension, the respondent→cell assignment after collapsing thin
// cells into their nearest neighbour by target proportion. Returns the active
// targets (fractions) and the per-respondent collapsed cell label.
function prepareDimension(
  derived: DerivedRespondent[],
  dim: keyof DimensionTargets,
  targetPct: Record<string, number>,
  collapses: string[],
): { cellByResp: string[]; target: Record<string, number> } {
  const counts: Record<string, number> = {}
  const cellByResp = derived.map((d) => {
    const c = cellOf(d, dim)
    counts[c] = (counts[c] || 0) + 1
    return c
  })
  // active cells = those present in targets (fraction) ∪ observed
  const target: Record<string, number> = {}
  for (const [k, v] of Object.entries(targetPct)) target[k] = v / 100
  // ensure observed-only cells exist with ~0 target (will be merged if thin)
  for (const c of Object.keys(counts)) if (!(c in target)) target[c] = 0

  const remap: Record<string, string> = {}
  const active = new Set(Object.keys(target))
  const minN = MIN_N[dim] ?? 15

  // iteratively merge smallest thin cell into nearest by target share
  let guard = 0
  while (active.size > 1 && guard++ < 100) {
    let thin: string | null = null
    let thinCount = Infinity
    for (const c of active) {
      const cnt = mergedCount(c, counts, remap)
      if (cnt < minN && cnt < thinCount) {
        thin = c
        thinCount = cnt
      }
    }
    if (!thin) break
    // nearest neighbour by |target share|
    let near: string | null = null
    let best = Infinity
    for (const c of active) {
      if (c === thin) continue
      const diff = Math.abs(target[c] - target[thin])
      if (diff < best) {
        best = diff
        near = c
      }
    }
    if (!near) break
    target[near] += target[thin]
    remap[thin] = near
    active.delete(thin)
    collapses.push(`${dim}: "${thin}" → "${near}" (n<${minN})`)
  }

  const finalTarget: Record<string, number> = {}
  for (const c of active) finalTarget[c] = target[c]
  const resolved = (c: string): string => {
    let cur = c
    while (remap[cur]) cur = remap[cur]
    return cur
  }
  return { cellByResp: cellByResp.map(resolved), target: finalTarget }
}

function mergedCount(cell: string, counts: Record<string, number>, remap: Record<string, string>): number {
  let total = counts[cell] || 0
  for (const [from, to] of Object.entries(remap)) {
    let cur = to
    while (remap[cur]) cur = remap[cur]
    if (cur === cell) total += counts[from] || 0
  }
  return total
}

function deff(weights: number[]): number {
  const n = weights.length
  if (!n) return 1
  const sum = weights.reduce((s, x) => s + x, 0)
  const sumSq = weights.reduce((s, x) => s + x * x, 0)
  return sum ? (n * sumSq) / (sum * sum) : 1
}

export interface RakeOptions {
  init?: number[] // starting weights (LV uses P(vote)); defaults to uniform
}

export function rake(
  derived: DerivedRespondent[],
  targets: DimensionTargets,
  activeDims: (keyof DimensionTargets)[],
  opts: RakeOptions = {},
): { weights: number[]; log: RakeLog } {
  const n = derived.length
  let weights = normalizeMean1(opts.init && opts.init.length === n ? [...opts.init] : new Array(n).fill(1))

  const collapses: string[] = []
  const dims = activeDims.map((dim) => ({ dim, ...prepareDimension(derived, dim, targets[dim] ?? {}, collapses) }))

  const rounds: ConvergenceRound[] = []
  // Uncapped sequential IPF, matching usmay.py: rake to all dimension targets
  // each round and iterate until the marginals settle (no per-round weight cap —
  // extreme weights are controlled afterward by the 99th-pct trim in recall
  // calibration). Empty target cells are folded in by the collapse step above.
  const MAX_ROUNDS = 50
  let prevDev: number | null = null
  let stalls = 0

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const { cellByResp, target } of dims) {
      const sums: Record<string, number> = {}
      let total = 0
      for (let i = 0; i < n; i++) {
        sums[cellByResp[i]] = (sums[cellByResp[i]] || 0) + weights[i]
        total += weights[i]
      }
      for (let i = 0; i < n; i++) {
        const cell = cellByResp[i]
        const observedShare = total ? (sums[cell] || 0) / total : 0
        const t = target[cell]
        if (t == null || observedShare === 0) continue
        weights[i] *= t / observedShare
      }
      weights = normalizeMean1(weights)
    }

    // max cell deviation across all dims (in share)
    let maxDev = 0
    for (const { cellByResp, target } of dims) {
      const sums: Record<string, number> = {}
      let total = 0
      for (let i = 0; i < n; i++) {
        sums[cellByResp[i]] = (sums[cellByResp[i]] || 0) + weights[i]
        total += weights[i]
      }
      for (const cell of Object.keys(target)) {
        const obs = total ? (sums[cell] || 0) / total : 0
        maxDev = Math.max(maxDev, Math.abs(obs - target[cell]))
      }
    }
    rounds.push({ round, maxDeviation: maxDev, deff: deff(weights), cap: null })
    if (maxDev < 1e-4) break
    // Stop only after two consecutive rounds with no meaningful improvement — IPF
    // plateaus above the strict tolerance when joint margins (e.g. Age×Sex and
    // Edu×Sex) are mutually inconsistent; the stall counter avoids halting a still-
    // converging rake on a single small step.
    if (prevDev !== null && prevDev - maxDev < 1e-5) {
      if (++stalls >= 2) break
    } else stalls = 0
    prevDev = maxDev
  }

  return { weights, log: { rounds, collapses } }
}

// ── Two-stage recall calibration ────────────────────────────────────────────
// Stage 1: among 2024 voters, rake to FEC certified shares (cap factor 2.0).
// Stage 2 (RV only): set the total DNV share to the CPS non-voter anchor.
// Then trim at the 99th percentile and renormalize.
export function recallCalibrate(
  weights: number[],
  derived: DerivedRespondent[],
  opts: { dnvAnchor: number | null },
): { weights: number[]; steps: { stage: string; note: string }[] } {
  let w = [...weights]
  const steps: { stage: string; note: string }[] = []

  // Stage 1 — voters to FEC shares
  const fecTotal = FEC_2024.Trump + FEC_2024.Harris + FEC_2024.Third
  const fec: Record<string, number> = {
    Trump: FEC_2024.Trump / fecTotal,
    Harris: FEC_2024.Harris / fecTotal,
    Third: FEC_2024.Third / fecTotal,
  }
  const voterIdx = derived.map((d, i) => (d.voted2024 ? i : -1)).filter((i) => i >= 0)
  if (voterIdx.length) {
    const sums: Record<string, number> = { Trump: 0, Harris: 0, Third: 0 }
    let total = 0
    for (const i of voterIdx) {
      sums[derived[i].recall] = (sums[derived[i].recall] || 0) + w[i]
      total += w[i]
    }
    for (const i of voterIdx) {
      const cell = derived[i].recall
      const obs = total ? sums[cell] / total : 0
      const t = fec[cell]
      if (t == null || obs === 0) continue
      const factor = Math.min(2.0, Math.max(0.5, t / obs))
      w[i] *= factor
    }
    steps.push({ stage: "Stage 1 — voters", note: "Raked 2024 voters to FEC certified shares (Trump 49.91 / Harris 48.39 / Third 1.70), per-respondent factor capped at 2.0×." })
  }

  // Stage 2 — non-voter anchor (RV only)
  if (opts.dnvAnchor != null) {
    const dnvIdx = derived.map((d, i) => (!d.voted2024 ? i : -1)).filter((i) => i >= 0)
    const total = w.reduce((s, x) => s + x, 0)
    const dnvSum = dnvIdx.reduce((s, i) => s + w[i], 0)
    const curShare = total ? dnvSum / total : 0
    const targetShare = opts.dnvAnchor / 100
    if (curShare > 0 && curShare < 1) {
      const dnvFactor = targetShare / curShare
      const voterFactor = (1 - targetShare) / (1 - curShare)
      for (let i = 0; i < w.length; i++) w[i] *= derived[i].voted2024 ? voterFactor : dnvFactor
      steps.push({ stage: "Stage 2 — non-voters", note: `Adjusted Did-Not-Vote share to the CPS 2024 anchor (${opts.dnvAnchor.toFixed(0)}%).` })
    }
  } else {
    steps.push({ stage: "Stage 2", note: "Skipped for the LV universe — P(vote) screening already suppresses non-voters; a CPS DNV anchor would double-count." })
  }

  // Trim at 99th percentile, renormalize
  const sorted = [...w].sort((a, b) => a - b)
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
  w = w.map((x) => Math.min(x, p99))
  w = normalizeMean1(w)
  return { weights: w, steps }
}

export function diagnostics(weights: number[], derived: DerivedRespondent[], targets: DimensionTargets): Diagnostics {
  const n = weights.length
  const sum = weights.reduce((s, x) => s + x, 0)
  const sumSq = weights.reduce((s, x) => s + x * x, 0)
  const deffVal = sum ? (n * sumSq) / (sum * sum) : 1
  const effN = sumSq ? (sum * sum) / sumSq : n
  const kishDeff = n ? n / effN : 1

  // recall2024 is calibrated to FEC/CPS after raking, so it intentionally
  // diverges from the raking marginal — exclude it from the demographic balance.
  const dimKeys = Object.keys(targets) as (keyof DimensionTargets)[]
  const smd = dimKeys.filter((d) => d !== "recall2024" && targets[d] && Object.keys(targets[d]!).length).map((dim) => {
    const sums: Record<string, number> = {}
    let total = 0
    derived.forEach((d, i) => {
      const c = cellOf(d, dim)
      sums[c] = (sums[c] || 0) + weights[i]
      total += weights[i]
    })
    let maxSmd = 0
    for (const [cell, tPct] of Object.entries(targets[dim]!)) {
      const obs = total ? (sums[cell] || 0) / total : 0
      const t = tPct / 100
      const sd = Math.sqrt(Math.max(1e-6, t * (1 - t)))
      maxSmd = Math.max(maxSmd, Math.abs(obs - t) / sd)
    }
    return { dimension: dim, maxSmd, balanced: maxSmd < 0.1 }
  })

  const sorted = [...weights].sort((a, b) => a - b)
  const median = n ? sorted[Math.floor(n / 2)] : 0
  const p99 = n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0
  const gt2 = n ? (weights.filter((w) => w > 2).length / n) * 100 : 0
  const gt3 = n ? (weights.filter((w) => w > 3).length / n) * 100 : 0

  return {
    n,
    effectiveN: Math.round(effN),
    deff: round2(deffVal),
    kishDeff: round2(kishDeff),
    moe: effN ? round1(98 / Math.sqrt(effN)) : 0,
    weightMin: round2(Math.min(...weights)),
    weightMax: round2(Math.max(...weights)),
    weightMean: round2(sum / n),
    weightMedian: round2(median),
    weightP99: round2(p99),
    pctGt2: round1(gt2),
    pctGt3: round1(gt3),
    smd: smd.map((s) => ({ ...s, maxSmd: round2(s.maxSmd) })),
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const round2 = (x: number) => Math.round(x * 100) / 100
