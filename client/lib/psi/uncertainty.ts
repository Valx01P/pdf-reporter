// Phase 4 + Phase 5 — uncertainty quantification for the Likely-Voter universe.
//
// Monte Carlo (9-scenario grid): 3 projected-turnout levels × 3 LV target sets
// (midterm-exit prior / P(vote)-derived / SOCAL composite). The full LV pipeline
// re-runs for each combination; the spread of each topline across the 9 runs is
// the honest uncertainty envelope.
//
// Bootstrap SE (Phase 5): respondents are resampled with replacement and both
// universes re-weighted, giving an empirical standard error per topline option.

import type { DerivedRespondent, DimensionTargets, LvConfig } from "./types"
import type { TargetSet } from "./constants"
import { TURNOUT_GRID, REGISTERED_VOTERS } from "./constants"
import { activeDimsFor, BASE_DIMS, buildAgeEduTargets, cellOf } from "./cells"
import { scoreLv } from "./lv"
import { applyLvAdjustments } from "./socal"
import { entropyBalance } from "./entropy"
import { rake, recallCalibrate } from "./rake"
import { tabulateQuestion } from "./tabulate"

export interface UncertaintyOption {
  label: string
  rv: number
  lv: number
  lvLow: number // min across the 9 Monte Carlo scenarios
  lvHigh: number // max across the 9 scenarios
  rvSe: number // bootstrap standard error
  lvSe: number
}

export interface UncertaintyResult {
  scenarios: { turnout: number; targetSet: string; meanPvote: number }[]
  bootstrapB: number
  envelopePp: number // median half-width of the LV envelope across options
  questions: { key: string; prompt: string; options: UncertaintyOption[] }[]
}

export interface Ctx {
  derived: DerivedRespondent[]
  rows: Record<string, string>[]
  substantiveKeys: string[]
  baseTargets: TargetSet
  lvConfig: LvConfig
  weightingSet: "A" | "B" | "C"
  rvWeights: number[]
  lvWeights: number[]
  baseRvTargets: DimensionTargets // SOCAL RV targets (+ ageEdu for Set B)
  baseLvTargets: DimensionTargets // SOCAL LV targets (+ ageEdu for Set B)
  lvPvote: number[] // base P(vote) per respondent
  cpsDnv: number | null
}

const TARGET_SETS = ["midterm-prior", "pvote-derived", "socal-composite"] as const
type TargetSetId = (typeof TARGET_SETS)[number]

function pvoteWeightedComposition(d: DerivedRespondent[], pvote: number[]): DimensionTargets {
  const out = {} as DimensionTargets
  for (const dim of BASE_DIMS) {
    const sums: Record<string, number> = {}
    let total = 0
    d.forEach((r, i) => {
      const c = cellOf(r, dim)
      sums[c] = (sums[c] || 0) + pvote[i]
      total += pvote[i]
    })
    const t: Record<string, number> = {}
    for (const k of Object.keys(sums)) t[k] = total ? (sums[k] / total) * 100 : 0
    out[dim] = t
  }
  return out
}

function socalBlend(prior: DimensionTargets, observed: DimensionTargets): DimensionTargets {
  const out = {} as DimensionTargets
  for (const dim of BASE_DIMS) {
    const p = prior[dim] || {}
    const o = observed[dim] || {}
    const cells = new Set([...Object.keys(p), ...Object.keys(o)])
    const blended: Record<string, number> = {}
    let sum = 0
    for (const c of cells) {
      const pv = p[c] ?? 0
      const ov = o[c] ?? 0
      const v = Math.abs(pv - ov) > 3 ? 0.7 * pv + 0.3 * ov : pv
      blended[c] = v
      sum += v
    }
    if (sum) for (const c of Object.keys(blended)) blended[c] = (blended[c] / sum) * 100
    out[dim] = blended
  }
  return out
}

function lvTargetsFor(setId: TargetSetId, ctx: Ctx, pvote: number[]): DimensionTargets {
  const prior = applyLvAdjustments(ctx.baseTargets)
  const observed = pvoteWeightedComposition(ctx.derived, pvote)
  let t: DimensionTargets
  if (setId === "midterm-prior") t = prior
  else if (setId === "pvote-derived") t = observed
  else t = socalBlend(prior, observed)
  if (ctx.weightingSet === "B") t.ageEdu = buildAgeEduTargets(t)
  return t
}

function lvWeightsForScenario(ctx: Ctx, turnoutVoters: number, setId: TargetSetId): { weights: number[]; meanPvote: number } {
  const projectedTurnout = turnoutVoters / REGISTERED_VOTERS
  const lv = scoreLv(ctx.derived, { ...ctx.lvConfig, projectedTurnout })
  const targets = lvTargetsFor(setId, ctx, lv.pvote)
  const dims = activeDimsFor(ctx.weightingSet, targets)
  const init = entropyBalance(ctx.derived, targets, dims, lv.pvote)
  const { weights } = rake(ctx.derived, targets, dims, { init })
  const { weights: w } = recallCalibrate(weights, ctx.derived, { dnvAnchor: null })
  return { weights: w, meanPvote: lv.meanPvote }
}

// Weighted option percentages keyed by label for one question.
function optionPct(rows: Record<string, string>[], derived: DerivedRespondent[], weights: number[], key: string): Map<string, number> {
  const q = tabulateQuestion(rows, derived, weights, key)
  return new Map(q.options.map((o) => [o.label, o.pct]))
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function runUncertainty(ctx: Ctx, opts: { bootstrap?: number } = {}): UncertaintyResult {
  const { rows, derived, substantiveKeys } = ctx
  const crosstabbable = substantiveKeys.filter((k) => {
    const t = tabulateQuestion(rows, derived, ctx.lvWeights, k).type
    return t !== "numeric" && t !== "open_ended"
  })

  // Base estimates
  const baseRv = new Map(crosstabbable.map((k) => [k, optionPct(rows, derived, ctx.rvWeights, k)]))
  const baseLv = new Map(crosstabbable.map((k) => [k, optionPct(rows, derived, ctx.lvWeights, k)]))

  // ── Monte Carlo 9-scenario grid ──
  const turnouts = [TURNOUT_GRID.low, TURNOUT_GRID.base, TURNOUT_GRID.high]
  const scenarios: UncertaintyResult["scenarios"] = []
  // envelope[key][label] -> {min,max}
  const env = new Map<string, Map<string, { min: number; max: number }>>()
  for (const k of crosstabbable) env.set(k, new Map())

  for (const voters of turnouts) {
    for (const setId of TARGET_SETS) {
      const { weights, meanPvote } = lvWeightsForScenario(ctx, voters, setId)
      scenarios.push({ turnout: voters, targetSet: setId, meanPvote: Math.round(meanPvote * 1000) / 1000 })
      for (const k of crosstabbable) {
        const pct = optionPct(rows, derived, weights, k)
        const m = env.get(k)!
        for (const [label, p] of pct) {
          const cur = m.get(label)
          if (!cur) m.set(label, { min: p, max: p })
          else {
            cur.min = Math.min(cur.min, p)
            cur.max = Math.max(cur.max, p)
          }
        }
      }
    }
  }

  // ── Bootstrap SE ──
  const n = derived.length
  const B = Math.max(0, Math.min(opts.bootstrap ?? 200, 400))
  const rvDims = activeDimsFor(ctx.weightingSet, ctx.baseRvTargets)
  const lvDims = activeDimsFor(ctx.weightingSet, ctx.baseLvTargets)
  // accumulate sum / sumSq of option pct across resamples
  const acc = new Map<string, Map<string, { rvS: number; rvSq: number; lvS: number; lvSq: number }>>()
  for (const k of crosstabbable) acc.set(k, new Map())
  const rng = mulberry32(424242)

  for (let b = 0; b < B; b++) {
    const counts = new Array(n).fill(0)
    for (let j = 0; j < n; j++) counts[Math.floor(rng() * n)]++
    // RV resample: rake from bootstrap counts
    const rvW = recallCalibrate(rake(derived, ctx.baseRvTargets, rvDims, { init: counts }).weights, derived, { dnvAnchor: ctx.cpsDnv }).weights
    // LV resample: counts × P(vote)
    const lvInit = counts.map((c, i) => c * ctx.lvPvote[i])
    const lvW = recallCalibrate(rake(derived, ctx.baseLvTargets, lvDims, { init: lvInit }).weights, derived, { dnvAnchor: null }).weights
    for (const k of crosstabbable) {
      const rvPct = optionPct(rows, derived, rvW, k)
      const lvPct = optionPct(rows, derived, lvW, k)
      const m = acc.get(k)!
      const labels = new Set([...rvPct.keys(), ...lvPct.keys()])
      for (const label of labels) {
        const rp = rvPct.get(label) ?? 0
        const lp = lvPct.get(label) ?? 0
        const cur = m.get(label) || { rvS: 0, rvSq: 0, lvS: 0, lvSq: 0 }
        cur.rvS += rp
        cur.rvSq += rp * rp
        cur.lvS += lp
        cur.lvSq += lp * lp
        m.set(label, cur)
      }
    }
  }
  const se = (s: number, sq: number) => {
    if (B < 2) return 0
    const mean = s / B
    return Math.sqrt(Math.max(0, sq / B - mean * mean))
  }

  const questions = crosstabbable.map((k) => {
    const labels = Array.from(baseLv.get(k)!.keys())
    const envM = env.get(k)!
    const accM = acc.get(k)!
    const options: UncertaintyOption[] = labels.map((label) => {
      const e = envM.get(label) || { min: baseLv.get(k)!.get(label) ?? 0, max: baseLv.get(k)!.get(label) ?? 0 }
      const a = accM.get(label) || { rvS: 0, rvSq: 0, lvS: 0, lvSq: 0 }
      return {
        label,
        rv: round1(baseRv.get(k)!.get(label) ?? 0),
        lv: round1(baseLv.get(k)!.get(label) ?? 0),
        lvLow: round1(e.min),
        lvHigh: round1(e.max),
        rvSe: round1(se(a.rvS, a.rvSq)),
        lvSe: round1(se(a.lvS, a.lvSq)),
      }
    })
    return { key: k, prompt: k, options }
  })

  // typical envelope half-width across the leading option of each question
  const halfWidths = questions
    .map((q) => q.options.slice().sort((a, b) => b.lv - a.lv)[0])
    .filter(Boolean)
    .map((o) => (o.lvHigh - o.lvLow) / 2)
    .sort((a, b) => a - b)
  const envelopePp = halfWidths.length ? round1(halfWidths[Math.floor(halfWidths.length / 2)]) : 0

  return { scenarios, bootstrapB: B, envelopePp, questions }
}

const round1 = (x: number) => Math.round(x * 10) / 10
