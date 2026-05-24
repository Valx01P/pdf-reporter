// Single source of truth for raking dimensions: how a respondent maps to a cell
// in each dimension, the min-n collapse thresholds, human labels, and which
// dimensions are active for each weighting set. Set A = 5 dimensions (33 cells),
// Set B adds the Age×Education joint (41 cells), Set C is a leaner 3-dimension
// set (21 cells).

import type { DerivedRespondent, DimensionTargets } from "./types"

export type DimKey = keyof DimensionTargets
export type BaseDimKey = "ageSex" | "eduSex" | "raceEdu" | "region" | "recall2024"

export const BASE_DIMS: BaseDimKey[] = ["ageSex", "eduSex", "raceEdu", "region", "recall2024"]

export const DIM_LABELS: Record<string, string> = {
  ageSex: "Age × Sex",
  eduSex: "Education × Sex",
  raceEdu: "Race × Education",
  region: "Region",
  recall2024: "2024 recall",
  ageEdu: "Age × Education",
}

export const DIM_MIN_N: Record<string, number> = {
  ageSex: 20,
  eduSex: 20,
  raceEdu: 20,
  ageEdu: 20,
  region: 15,
  recall2024: 15,
}

export function cellOf(d: DerivedRespondent, dim: DimKey): string {
  switch (dim) {
    case "ageSex": return d.ageSex
    case "eduSex": return d.eduSex
    case "raceEdu": return d.raceEdu
    case "region": return d.region
    case "recall2024": return d.recall
    case "ageEdu": return d.ageEdu
  }
}

// Active raking dimensions for a weighting set, given which targets exist.
export function activeDimsFor(set: "A" | "B" | "C", targets: DimensionTargets): DimKey[] {
  if (set === "C") return ["ageSex", "raceEdu", "recall2024"]
  if (set === "B" && targets.ageEdu && Object.keys(targets.ageEdu).length) {
    return [...BASE_DIMS, "ageEdu"]
  }
  return BASE_DIMS
}

// Derive the Age×Education joint target from the age and education marginals
// (independence). Used for Set B when no joint target is supplied externally.
export function buildAgeEduTargets(targets: DimensionTargets): Record<string, number> {
  const ageM: Record<string, number> = {}
  for (const [cell, v] of Object.entries(targets.ageSex)) {
    const age = cell.split(" · ")[0]
    ageM[age] = (ageM[age] || 0) + v
  }
  const eduM: Record<string, number> = {}
  for (const [cell, v] of Object.entries(targets.eduSex)) {
    const bin = cell.split(" · ")[1] || cell
    eduM[bin] = (eduM[bin] || 0) + v
  }
  const joint: Record<string, number> = {}
  let sum = 0
  for (const age of Object.keys(ageM)) {
    for (const bin of Object.keys(eduM)) {
      const v = (ageM[age] / 100) * eduM[bin]
      joint[`${age} · ${bin}`] = v
      sum += v
    }
  }
  if (sum) for (const k of Object.keys(joint)) joint[k] = (joint[k] / sum) * 100
  return joint
}
