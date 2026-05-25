// Custom weighting: rake arbitrary user-chosen variables (any demographic or
// survey column) to user-entered benchmark targets. Kept separate from the fixed
// Set A/B/C engine in rake.ts so the default pipeline is untouched. Same method
// as rake.ts: thin-cell collapse, uncapped iterative IPF with plateau-stop, and
// a 99th-percentile trim to control extreme weights.

import type { ConvergenceRound, Diagnostics, RakeLog } from "./types"

export interface CustomVariable {
  key: string
  label: string
  isDemo: boolean
  cellByResp: string[] // resolved cell label per kept respondent
  target: Record<string, number> // category → target % (normalized internally)
}

const MIN_N = 15
const MAX_ROUNDS = 50

function normalizeMean1(w: number[]): number[] {
  const sum = w.reduce((s, x) => s + x, 0)
  const f = sum ? w.length / sum : 1
  return w.map((x) => x * f)
}

function deff(weights: number[]): number {
  const n = weights.length
  if (!n) return 1
  const sum = weights.reduce((s, x) => s + x, 0)
  const sumSq = weights.reduce((s, x) => s + x * x, 0)
  return sum ? (n * sumSq) / (sum * sum) : 1
}

// Target as fractions summing to 1 (ignoring negatives); robust to imperfect entry.
function fractions(target: Record<string, number>): Record<string, number> {
  const sum = Object.values(target).reduce((s, x) => s + (x > 0 ? x : 0), 0)
  const out: Record<string, number> = Object.create(null)
  for (const [k, v] of Object.entries(target)) out[k] = sum > 0 ? Math.max(0, v) / sum : 0
  return out
}

interface Prepared { label: string; cellByResp: string[]; target: Record<string, number> }

// Collapse cells with n<MIN_N into the nearest by target share (their target is
// folded into the survivor), then return per-respondent collapsed cells + targets.
function prepare(v: CustomVariable, collapses: string[]): Prepared {
  const counts: Record<string, number> = Object.create(null)
  let n = 0
  for (const c of v.cellByResp) {
    counts[c] = (counts[c] || 0) + 1
    n++
  }

  // User cells take the user's normalized fractions, scaled to leave room for any
  // untargeted observed cells (blanks / unlisted answers) — those keep their
  // observed share so non-responders aren't raked toward zero.
  const userFrac = fractions(v.target)
  let untargetedShare = 0
  for (const c of Object.keys(counts)) if (!(c in v.target)) untargetedShare += (counts[c] || 0) / n
  const target: Record<string, number> = Object.create(null)
  for (const [c, f] of Object.entries(userFrac)) target[c] = f * (1 - untargetedShare)
  for (const c of Object.keys(counts)) if (!(c in v.target)) target[c] = (counts[c] || 0) / n

  const remap: Record<string, string> = Object.create(null)
  const active = new Set(Object.keys(target))
  const merged = (c: string): number => {
    let total = counts[c] || 0
    for (const [from, to] of Object.entries(remap)) {
      let cur = to
      while (remap[cur]) cur = remap[cur]
      if (cur === c) total += counts[from] || 0
    }
    return total
  }
  let guard = 0
  while (active.size > 1 && guard++ < 100) {
    let thin: string | null = null
    let thinCount = Infinity
    for (const c of active) {
      const cnt = merged(c)
      if (cnt < MIN_N && cnt < thinCount) {
        thin = c
        thinCount = cnt
      }
    }
    if (!thin) break
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
    collapses.push(`${v.label}: "${thin}" → "${near}" (n<${MIN_N})`)
  }
  const finalTarget: Record<string, number> = Object.create(null)
  for (const c of active) finalTarget[c] = target[c]
  const resolve = (c: string): string => {
    let cur = c
    while (remap[cur]) cur = remap[cur]
    return cur
  }
  return { label: v.label, cellByResp: v.cellByResp.map(resolve), target: finalTarget }
}

// Rake to the custom variables. `init` seeds the weights (uniform for RV, P(vote)
// for LV); the final 99th-pct trim mirrors the default engine's recall step.
export function rakeCustom(vars: CustomVariable[], init?: number[]): { weights: number[]; log: RakeLog } {
  const n = vars[0]?.cellByResp.length ?? init?.length ?? 0
  let weights = normalizeMean1(init && init.length === n ? [...init] : new Array(n).fill(1))
  const collapses: string[] = []
  // Skip variables with no positive target (all-zero/empty) — they carry no
  // constraint and would otherwise rake every weight to zero.
  const dims = vars.filter((v) => Object.values(v.target).some((x) => x > 0)).map((v) => prepare(v, collapses))
  const rounds: ConvergenceRound[] = []
  let prevDev: number | null = null
  let stalls = 0

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const { cellByResp, target } of dims) {
      const sums: Record<string, number> = Object.create(null)
      let total = 0
      for (let i = 0; i < n; i++) {
        sums[cellByResp[i]] = (sums[cellByResp[i]] || 0) + weights[i]
        total += weights[i]
      }
      for (let i = 0; i < n; i++) {
        const cell = cellByResp[i]
        const obs = total ? (sums[cell] || 0) / total : 0
        const t = target[cell]
        if (t == null || obs === 0) continue
        weights[i] *= t / obs
      }
      weights = normalizeMean1(weights)
    }

    let maxDev = 0
    for (const { cellByResp, target } of dims) {
      const sums: Record<string, number> = Object.create(null)
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
    // Stop only after two consecutive rounds with no meaningful improvement, so a
    // single small step doesn't halt a still-converging rake prematurely.
    if (prevDev !== null && prevDev - maxDev < 1e-5) {
      if (++stalls >= 2) break
    } else stalls = 0
    prevDev = maxDev
  }

  // 99th-percentile trim, then renormalize (matches rake.ts recall calibration).
  if (n > 0) {
    const sorted = [...weights].sort((a, b) => a - b)
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
    if (p99 > 0) weights = normalizeMean1(weights.map((x) => Math.min(x, p99)))
  }
  return { weights, log: { rounds, collapses } }
}

const round1 = (x: number) => Math.round(x * 10) / 10
const round2 = (x: number) => Math.round(x * 100) / 100

// DEFF / effective N / MoE + per-variable SMD against the user targets.
export function customDiagnostics(weights: number[], vars: CustomVariable[]): Diagnostics {
  const n = weights.length
  const sum = weights.reduce((s, x) => s + x, 0)
  const sumSq = weights.reduce((s, x) => s + x * x, 0)
  const deffVal = sum ? (n * sumSq) / (sum * sum) : 1
  const effN = sumSq ? (sum * sum) / sumSq : n

  const smd = vars.map((v) => {
    const target = fractions(v.target)
    const sums: Record<string, number> = {}
    let total = 0
    v.cellByResp.forEach((c, i) => {
      sums[c] = (sums[c] || 0) + weights[i]
      total += weights[i]
    })
    let maxSmd = 0
    for (const [cell, t] of Object.entries(target)) {
      const obs = total ? (sums[cell] || 0) / total : 0
      const sd = Math.sqrt(Math.max(1e-6, t * (1 - t)))
      maxSmd = Math.max(maxSmd, Math.abs(obs - t) / sd)
    }
    return { dimension: v.label, maxSmd: round2(maxSmd), balanced: maxSmd < 0.1 }
  })

  const sorted = [...weights].sort((a, b) => a - b)
  const median = n ? sorted[Math.floor(n / 2)] : 0
  const p99 = n ? sorted[Math.min(n - 1, Math.floor(n * 0.99))] : 0

  return {
    n,
    effectiveN: Math.round(effN),
    deff: round2(deffVal),
    kishDeff: round2(n ? n / effN : 1),
    moe: effN ? round1(98 / Math.sqrt(effN)) : 0,
    weightMin: round2(weights.length ? Math.min(...weights) : 0),
    weightMax: round2(weights.length ? Math.max(...weights) : 0),
    weightMean: round2(n ? sum / n : 0),
    weightMedian: round2(median),
    weightP99: round2(p99),
    pctGt2: round1(n ? (weights.filter((w) => w > 2).length / n) * 100 : 0),
    pctGt3: round1(n ? (weights.filter((w) => w > 3).length / n) * 100 : 0),
    smd,
  }
}
