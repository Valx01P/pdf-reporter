// Pathway 3 engine types.

export type HistoryBucket = "consistent" | "occasional" | "new"

// One respondent after the shared Phase 1 derivation step.
export interface DerivedRespondent {
  i: number // original row index
  ageBucket: string // 18-29 / 30-44 / 45-64 / 65+
  sex: string // Male / Female
  edu: string // HS or less / Some college / College grad / Postgrad
  eduBin: "College" | "No College"
  raceEdu: string // 5-cell
  region: string // 8-region
  income: string // 7-band income bracket, or "" when no income column
  party: string // Republican / Democrat / Independent, or "" when no party column
  recall: string // Trump / Harris / Third / DNV
  // joint cell labels
  ageSex: string
  eduSex: string
  ageEdu: string
  // LV inputs — raw response strings; weights resolved in the LV step
  q3: string
  q4: string
  q5: string
  historyBucket: HistoryBucket
  votedElections: number
  voted2024: boolean
}

export interface ColumnMapping {
  q2?: string // vote history (multi-select)
  q3?: string // motivation
  q4?: string // preparedness
  q5?: string // social
  age?: string
  sex?: string
  education?: string
  race?: string
  region?: string
  state?: string
  income?: string
  party?: string
  recall2024?: string
}

export interface QualityReport {
  total: number
  speeders: number
  straightliners: number
  removed: number
  kept: number
  durationCol?: string
}

export interface LvConfig {
  q3Map: Record<string, number>
  q4Map: Record<string, number>
  q5Map: Record<string, number>
  k: { consistent: number; occasional: number; new: number }
  projectedTurnout: number // 0..1
}

export interface LvResult {
  raw: number[] // geometric LV_raw per kept respondent
  pvote: number[] // calibrated P(vote)
  mu: number // solved logistic midpoint
  meanPvote: number
  highCount: number // P>=0.9
  lowCount: number // P<=0.1
  buckets: { consistent: number; occasional: number; new: number }
  rawHist: { label: string; count: number }[]
  pvoteHist: { label: string; count: number }[]
}

export interface DimensionTargets {
  ageSex: Record<string, number>
  eduSex: Record<string, number>
  raceEdu: Record<string, number>
  region: Record<string, number>
  recall2024: Record<string, number>
  ageEdu?: Record<string, number> // Set B only — Age×Education joint
}

export interface SocalCell {
  cell: string
  prior: number
  observed: number
  final: number
  updated: boolean // true if the 70/30 blend fired (diff > 3pp)
}

export interface SocalAudit {
  rv: Record<string, SocalCell[]>
  lv: Record<string, SocalCell[]>
}

export interface ConvergenceRound {
  round: number
  maxDeviation: number
  deff: number
  cap: number | null
}

export interface RakeLog {
  rounds: ConvergenceRound[]
  collapses: string[]
}

export interface Diagnostics {
  n: number
  effectiveN: number
  deff: number
  kishDeff: number
  moe: number
  weightMin: number
  weightMax: number
  weightMean: number
  weightMedian?: number
  weightP99?: number
  pctGt2?: number // % of (mean-1-normalized) weights above 2× the mean
  pctGt3?: number // % above 3× the mean
  smd: { dimension: string; maxSmd: number; balanced: boolean }[]
}

export interface UniverseWeights {
  universe: "RV" | "LV"
  weights: number[] // aligned to kept respondents, mean 1
  targets: DimensionTargets
  rakeLog: RakeLog
  diagnostics: Diagnostics
  recall: { stage: string; note: string }[]
}

export interface ShiftRow {
  cell: string
  rv: number // RV weighted composition
  pvote: number // post-P(vote), pre re-rake
  lv: number // final LV composition
}

export interface PipelineResult {
  name: string
  quality: QualityReport
  keptCount: number
  derived: DerivedRespondent[]
  lv: LvResult
  socal: SocalAudit
  rv: UniverseWeights
  lvUniverse: UniverseWeights
  shift: { dimension: string; rows: ShiftRow[] }[]
  warnings: string[]
}
