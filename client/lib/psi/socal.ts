// Phases 0 & 2 — SOCAL (Survey-Observed Calibrated Adaptive Likelihood) target
// derivation. The pre-survey prior is blended with the observed sample
// composition only when they diverge beyond 3pp, placing 70% credibility on the
// external benchmark and 30% on the survey. Run independently for RV and LV; the
// LV "observed" composition is P(vote)-weighted.

import type { DerivedRespondent, DimensionTargets, SocalCell } from "./types"
import type { TargetSet } from "./constants"
import { BASE_DIMS, cellOf } from "./cells"

// SOCAL updates the five base-dimension targets; the Age×Education joint (Set B)
// is derived from the updated marginals downstream, not SOCAL-blended.
const DIM_KEYS = BASE_DIMS

// Observed composition (% per cell) for a dimension, optionally P(vote)-weighted.
function observed(derived: DerivedRespondent[], dim: keyof DimensionTargets, w?: number[]): Record<string, number> {
  const sums: Record<string, number> = {}
  let total = 0
  derived.forEach((d, idx) => {
    const weight = w ? w[idx] : 1
    const c = cellOf(d, dim)
    sums[c] = (sums[c] || 0) + weight
    total += weight
  })
  const out: Record<string, number> = {}
  for (const k of Object.keys(sums)) out[k] = total ? (sums[k] / total) * 100 : 0
  return out
}

function renormalize(t: Record<string, number>): Record<string, number> {
  const sum = Object.values(t).reduce((s, v) => s + v, 0)
  if (!sum) return t
  const out: Record<string, number> = {}
  for (const k of Object.keys(t)) out[k] = (t[k] / sum) * 100
  return out
}

// Credibility update for one dimension. Returns the final targets + audit cells.
function socalDim(prior: Record<string, number>, obs: Record<string, number>): { final: Record<string, number>; cells: SocalCell[] } {
  const cells: SocalCell[] = []
  const final: Record<string, number> = {}
  const keys = new Set([...Object.keys(prior), ...Object.keys(obs)])
  for (const cell of keys) {
    const p = prior[cell] ?? 0
    const o = obs[cell] ?? 0
    const diff = Math.abs(p - o)
    const updated = diff > 3
    const f = updated ? 0.7 * p + 0.3 * o : p
    final[cell] = f
    cells.push({ cell, prior: p, observed: o, final: f, updated })
  }
  return { final: renormalize(final), cells }
}

export function deriveRvTargets(derived: DerivedRespondent[], base: TargetSet): {
  targets: DimensionTargets
  audit: Record<string, SocalCell[]>
} {
  const targets = {} as DimensionTargets
  const audit: Record<string, SocalCell[]> = {}
  for (const dim of DIM_KEYS) {
    const { final, cells } = socalDim(base[dim], observed(derived, dim))
    targets[dim] = final
    audit[dim] = cells
  }
  return { targets, audit }
}

export function deriveLvTargets(derived: DerivedRespondent[], base: TargetSet, pvote: number[]): {
  targets: DimensionTargets
  audit: Record<string, SocalCell[]>
} {
  const prior = applyLvAdjustments(base)
  const targets = {} as DimensionTargets
  const audit: Record<string, SocalCell[]> = {}
  for (const dim of DIM_KEYS) {
    const { final, cells } = socalDim(prior[dim], observed(derived, dim, pvote))
    targets[dim] = final
    audit[dim] = cells
  }
  return { targets, audit }
}

// The documented LV directional shifts applied to the RV base to form the LV
// prior (Phase 0 LV benchmark). Deterministic, then renormalised per dimension.
export function applyLvAdjustments(base: TargetSet): DimensionTargets {
  const ageSex = { ...base.ageSex }
  // compress 18-29 by 2.5pp total, redistribute to 65+
  const young = Object.keys(ageSex).filter((k) => k.startsWith("18-29"))
  const old = Object.keys(ageSex).filter((k) => k.startsWith("65+"))
  const youngTotal = young.reduce((s, k) => s + ageSex[k], 0)
  const oldTotal = old.reduce((s, k) => s + ageSex[k], 0)
  const shift = 2.5
  for (const k of young) ageSex[k] -= shift * (ageSex[k] / youngTotal)
  for (const k of old) ageSex[k] += shift * (ageSex[k] / oldTotal)

  const eduSex = { ...base.eduSex }
  // 2pp No College -> College per sex
  for (const sex of ["Male", "Female"]) {
    const noc = `${sex} · No College`
    const col = `${sex} · College`
    if (noc in eduSex && col in eduSex) {
      eduSex[noc] -= 2
      eduSex[col] += 2
    }
  }

  const raceEdu = { ...base.raceEdu }
  if ("White College" in raceEdu) raceEdu["White College"] += 2
  if ("White No College" in raceEdu) raceEdu["White No College"] -= 0.5
  if ("Hispanic" in raceEdu) raceEdu["Hispanic"] -= 1.5

  const region = { ...base.region }

  // recall: DNV -> 7%, voters rescaled proportionally
  const recall2024 = { ...base.recall2024 }
  const dnvNew = 7
  const voters = Object.keys(recall2024).filter((k) => k !== "DNV")
  const voterTotal = voters.reduce((s, k) => s + recall2024[k], 0)
  const scale = voterTotal ? (100 - dnvNew) / voterTotal : 1
  for (const k of voters) recall2024[k] *= scale
  if ("DNV" in recall2024) recall2024["DNV"] = dnvNew

  return {
    ageSex: renormalize(ageSex),
    eduSex: renormalize(eduSex),
    raceEdu: renormalize(raceEdu),
    region: renormalize(region),
    recall2024: renormalize(recall2024),
  }
}
