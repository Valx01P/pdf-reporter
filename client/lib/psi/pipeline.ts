// Orchestrates Pathway 3 for the v1 core: Phase 1 (derive) → LV scoring →
// Phase 2 (SOCAL targets, independent per universe) → Phase 3a (RV rake +
// recall) → Phase 3b (LV rake seeded by P(vote) + voter-only recall) → Phase 5
// diagnostics + shift decomposition. Entropy balancing and full Monte Carlo are
// the documented hardening-pass items and are not yet applied here.

import { deriveAll, type ParsedCsv } from "./derive"
import { scoreLv } from "./lv"
import { deriveLvTargets, deriveRvTargets } from "./socal"
import { diagnostics, rake, recallCalibrate } from "./rake"
import { entropyBalance } from "./entropy"
import { activeDimsFor, buildAgeEduTargets, BASE_DIMS, cellOf } from "./cells"
import { CPS_DNV_SHARE, type TargetSet } from "./constants"
import type {
  ColumnMapping,
  DimensionTargets,
  LvConfig,
  PipelineResult,
  ShiftRow,
} from "./types"

const DIM_KEYS = BASE_DIMS

export interface PipelineInput {
  name: string
  parsed: ParsedCsv
  mapping: ColumnMapping
  substantiveKeys: string[]
  lvConfig: LvConfig
  baseTargets: TargetSet
  weightingSet: "A" | "B" | "C"
  cpsDnv?: number
}

function composition(derived: PipelineResult["derived"], dim: keyof DimensionTargets, w: number[]): Record<string, number> {
  const sums: Record<string, number> = {}
  let total = 0
  derived.forEach((d, i) => {
    sums[cellOf(d, dim)] = (sums[cellOf(d, dim)] || 0) + w[i]
    total += w[i]
  })
  const out: Record<string, number> = {}
  for (const k of Object.keys(sums)) out[k] = total ? (sums[k] / total) * 100 : 0
  return out
}

export function runPathway3(input: PipelineInput): PipelineResult {
  const warnings: string[] = []

  // Phase 1 — shared derivation + quality screen
  const { derived, quality, coerced } = deriveAll(input.parsed, input.mapping, input.substantiveKeys)
  if (coerced > 0) warnings.push(`${coerced} respondent${coerced === 1 ? "" : "s"} had non-binary or unrecognised sex coerced to a binary cell for raking.`)
  if (!input.mapping.q3 || !input.mapping.q4 || !input.mapping.q5)
    warnings.push("One or more of the Q3/Q4/Q5 likely-voter questions was not mapped — LV scores fall back to neutral (0.5) for the missing dimension.")
  const demoCols = [input.mapping.age, input.mapping.sex, input.mapping.education, input.mapping.race, input.mapping.region, input.mapping.state].filter(Boolean).length
  if (demoCols === 0)
    warnings.push("No demographic columns were detected, so weighting can't correct the sample — results are effectively unweighted. Map age, sex, education, race, or region/state in the Data tab.")
  else if (demoCols < 3)
    warnings.push("Few demographic columns were detected; weighting is limited. Map more of age, sex, education, race, and region/state for full raking.")
  if (!input.mapping.recall2024) warnings.push("No 2024 recall column was mapped — recall calibration (FEC/CPS) is skipped.")
  if (quality.kept < 1000) warnings.push(`Kept sample is ${quality.kept.toLocaleString()} — Pathway 3 recommends 1,000+ (Set B 1,200+) for full defensibility.`)

  // LV scoring on the raw unweighted sample
  const lv = scoreLv(derived, input.lvConfig)

  // Phase 2 — independent SOCAL targets
  const rvTargets = deriveRvTargets(derived, input.baseTargets)
  const lvTargets = deriveLvTargets(derived, input.baseTargets, lv.pvote)

  // Set B adds the Age×Education joint, derived from the SOCAL-updated age and
  // education marginals (no external joint target is published, so independence
  // is the principled prior). Set C uses a leaner three-dimension set.
  if (input.weightingSet === "B") {
    rvTargets.targets.ageEdu = buildAgeEduTargets(rvTargets.targets)
    lvTargets.targets.ageEdu = buildAgeEduTargets(lvTargets.targets)
    warnings.push("Set B: the Age×Education joint dimension is derived from the age and education marginals under independence (no published joint target exists).")
  }
  const activeDims = activeDimsFor(input.weightingSet, rvTargets.targets)

  // Phase 3a — RV track: entropy-balancing init (from uniform) → raking
  const uniform = new Array(derived.length).fill(1)
  const rvInit = entropyBalance(derived, rvTargets.targets, activeDims, uniform)
  const rvRake = rake(derived, rvTargets.targets, activeDims, { init: rvInit })
  const rvRecall = recallCalibrate(rvRake.weights, derived, { dnvAnchor: input.cpsDnv ?? CPS_DNV_SHARE })
  const rvDiag = diagnostics(rvRecall.weights, derived, rvTargets.targets)
  if (rvDiag.deff > 2.0) warnings.push(`RV design effect is ${rvDiag.deff} (>2.0) — review weight distribution before publication.`)

  // Phase 3b — LV track: entropy balancing seeded by P(vote) → raking
  const lvInit = entropyBalance(derived, lvTargets.targets, activeDims, lv.pvote)
  const lvRake = rake(derived, lvTargets.targets, activeDims, { init: lvInit })
  const lvRecall = recallCalibrate(lvRake.weights, derived, { dnvAnchor: null })
  const lvDiag = diagnostics(lvRecall.weights, derived, lvTargets.targets)
  if (lvDiag.deff > 2.0) warnings.push(`LV design effect is ${lvDiag.deff} (>2.0) — review weight distribution before publication.`)

  // Shift decomposition: RV composition vs post-P(vote) vs final LV
  const shift = DIM_KEYS.map((dim) => {
    const rvComp = composition(derived, dim, rvRecall.weights)
    const pvComp = composition(derived, dim, lv.pvote)
    const lvComp = composition(derived, dim, lvRecall.weights)
    const cells = new Set([...Object.keys(rvComp), ...Object.keys(lvComp)])
    const rows: ShiftRow[] = Array.from(cells)
      .map((cell) => ({ cell, rv: rvComp[cell] || 0, pvote: pvComp[cell] || 0, lv: lvComp[cell] || 0 }))
      .sort((a, b) => b.lv - a.lv)
    return { dimension: dim, rows }
  })

  return {
    name: input.name,
    quality,
    keptCount: derived.length,
    derived,
    lv,
    socal: { rv: rvTargets.audit, lv: lvTargets.audit },
    rv: {
      universe: "RV",
      weights: rvRecall.weights,
      targets: rvTargets.targets,
      rakeLog: rvRake.log,
      diagnostics: rvDiag,
      recall: rvRecall.steps,
    },
    lvUniverse: {
      universe: "LV",
      weights: lvRecall.weights,
      targets: lvTargets.targets,
      rakeLog: lvRake.log,
      diagnostics: lvDiag,
      recall: lvRecall.steps,
    },
    shift,
    warnings,
  }
}
