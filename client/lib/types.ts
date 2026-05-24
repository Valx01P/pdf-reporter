// Shared types for the Toplines engine. The server route handlers do all the
// processing and return these shapes; the client only renders them.

export type QuestionType =
  | "categorical" // unordered choices -> horizontal bars
  | "scale" // ordered Likert / rating -> diverging bars
  | "binary" // two options (Yes/No) -> bars
  | "numeric" // free numeric -> histogram + summary stats
  | "nps" // 0-10 recommend -> promoter/passive/detractor split
  | "open_ended" // free text -> sample quotes + AI sentiment

export interface ToplineOption {
  label: string
  count: number // raw respondents choosing this option
  weighted: number // weighted count (equals count when unweighted)
  pct: number // weighted share of those who answered (0-100)
}

export interface NumericStats {
  mean: number
  median: number
  min: number
  max: number
  stdev: number
}

export interface NpsStats {
  promoters: number // % 9-10
  passives: number // % 7-8
  detractors: number // % 0-6
  score: number // promoters% - detractors%, -100..100
}

export interface HistogramBin {
  label: string
  lo: number
  hi: number
  count: number
  weighted: number
  pct: number
}

export interface Question {
  key: string // CSV column header — stable id
  prompt: string // display prompt
  type: QuestionType
  answered: number // raw non-blank answers
  weightedAnswered: number
  moe: number // ± percentage points at 95% CI for this question's n
  options: ToplineOption[] // categorical / scale / binary / nps buckets
  scaleMeta?: { neutralIndex: number } // index into options of the neutral point, or -1
  numeric?: NumericStats
  histogram?: HistogramBin[]
  nps?: NpsStats
  openSamples?: string[]
  openCount?: number
}

export interface DemographicValue {
  value: string
  count: number
  pct: number // sample share (0-100)
}

export interface Demographic {
  key: string
  label: string
  values: DemographicValue[] // sorted by count desc
}

export interface Analysis {
  name: string
  n: number // total respondents (rows)
  moe: number // ± percentage points at 95% CI, p=0.5
  weighted: boolean
  effectiveN: number // Kish effective sample size (equals n when unweighted)
  questions: Question[]
  demographics: Demographic[]
  warnings: string[]
}

export interface CrosstabCell {
  col: string
  count: number // weighted count in this column choosing this row option
  pct: number // column %: share of the column that chose this option
  significant: boolean // diverges from the row's "All" beyond the 95% CI
  moe: number
}

export interface CrosstabRow {
  label: string
  cells: CrosstabCell[]
  all: { count: number; pct: number }
}

export interface Crosstab {
  questionKey: string
  questionPrompt: string
  dim: string
  dimLabel: string
  columns: string[]
  columnTotals: number[] // weighted n per column
  rows: CrosstabRow[]
}

// ── Tabbook ──────────────────────────────────────────────────────────────────
// A single wide grid (one universe): every question's Total on the left and all
// demographic banner groups to the right, sharing one fixed column set. Mirrors
// the PSI reference Tabbook (RV_Tabbook / LV_Tabbook).

export interface TabbookColumn {
  group: string // banner group header, e.g. "Age", "Race (W College/No College)"
  groupKey: string // dim / question key the column belongs to ("__total__" for Total)
  label: string // column header, e.g. "18-29", "White College", or "Total"
  value: string // underlying raw category value (equals label for Total)
  isTotal: boolean
  unweightedN: number // raw respondents in this banner category (question-independent)
}

export interface TabbookGroup {
  label: string // group header text
  span: number // number of columns the group covers
}

export interface TabbookRow {
  label: string // response option
  pct: number[] // weighted column-% aligned to columns; index 0 = Total
  significant: boolean[] // aligned to columns; Total is always false
}

export interface TabbookQuestion {
  key: string
  prompt: string
  type: QuestionType
  rows: TabbookRow[] // empty for numeric / open_ended
  note?: string // one-line summary for numeric / open_ended questions
}

export interface Tabbook {
  name: string
  universe: "RV" | "LV"
  groups: TabbookGroup[] // grouped header row: Total (span 1) then each banner group
  columns: TabbookColumn[] // flat column list, index 0 = Total
  questions: TabbookQuestion[]
}

export interface WeightTarget {
  dim: string
  targets: Record<string, number> // value -> target share (0..1)
}

export interface WeightingConfig {
  enabled: boolean
  targets: WeightTarget[]
}

export interface AiSummary {
  headline: string
  overview: string
  findings: string[]
  methodologyNote: string
  ai: boolean // true when produced by the model, false for the template fallback
}

export interface ReportMeta {
  name: string
  subtitle?: string // e.g. "Anonymous · n=612 · ±3.9% MoE"
  fieldStart?: string
  fieldEnd?: string
  client?: string
  pollster?: string
}
