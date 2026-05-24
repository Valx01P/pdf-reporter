// The Toplines processing engine. Pure TypeScript, run only inside server route
// handlers. Parses a respondent-level polling CSV, classifies each column,
// infers question types, tabulates weighted toplines, and builds crosstabs with
// significance testing. Weighting is iterative proportional fitting (raking).

import Papa from "papaparse"
import { matchScale, orderByScale, isNeutralLabel } from "./scales"
import { rake, effectiveSampleSize } from "./weighting"
import type {
  Analysis,
  Crosstab,
  CrosstabRow,
  Demographic,
  HistogramBin,
  Question,
  QuestionType,
  ToplineOption,
  WeightingConfig,
} from "./types"

// ── Column role detection ────────────────────────────────────────────────

// Bookkeeping columns that are neither questions nor crosstab dimensions.
const IGNORE_RE =
  /^(id|_id|uuid|guid|respondent(_?id)?|resp(_?id)?|row(_?id)?|record(_?id)?|index|seq|timestamp|time|date(time)?|start(_?time|ed)?|end(_?time|ed)?|submitted(_?at)?|created(_?at)?|completed(_?at)?|duration|loi|phone|phone_?number|mobile|cell|email|e-?mail|name|first_?name|last_?name|fullname|ip|ip_?address|user_?agent|source|channel|mode|language|lang)$/i

const WEIGHT_RE = /^(weight|weights|wt|final_?weight|design_?weight|raked?_?weight)$/i

interface DemoSpec {
  key: string
  label: string
  band: boolean // numeric age column -> banded into cohorts
}

const DEMO_DEFS: { re: RegExp; label: string; age?: boolean }[] = [
  { re: /^(age|age_?years?|respondent_?age|exact_?age)$/i, label: "Age", age: true },
  { re: /^(age_?(group|band|range|bucket|cohort|cat(egory)?)|agegroup|ageband)$/i, label: "Age" },
  { re: /^(gender|sex|gender_?identity)$/i, label: "Gender" },
  { re: /^(party|party_?id|partyid|party_?affiliation|partisanship|pid|reg_?party)$/i, label: "Party" },
  { re: /^(race|ethnicity|race_?ethnicity|ethnic(ity)?)$/i, label: "Ethnicity" },
  { re: /^(region|area|geography|geo)$/i, label: "Region" },
  { re: /^(state|st)$/i, label: "State" },
  { re: /^(county)$/i, label: "County" },
  { re: /^(cd|district|congressional_?district|cong_?district|house_?district)$/i, label: "District" },
  { re: /^(zip|zipcode|zip_?code|postal_?code)$/i, label: "ZIP" },
  { re: /^(income|income_?(band|bracket|group|range|level)|hh_?income|household_?income)$/i, label: "Income" },
  { re: /^(education|educ|edu|education_?(level|band)|edu_?level)$/i, label: "Education" },
  { re: /^(urbanicity|urbanity|urban_?rural|density)$/i, label: "Urbanicity" },
  { re: /^(generation|gen|age_?generation)$/i, label: "Generation" },
  { re: /^(religion|relig)$/i, label: "Religion" },
  { re: /^(turnout|propensity|vote_?propensity|likely_?voter|lv)$/i, label: "Propensity" },
]

interface ColumnInfo {
  ignore: string[]
  weightCols: string[]
  demographics: DemoSpec[]
  questionKeys: string[]
}

export interface AnalysisContext {
  headers: string[]
  rows: Record<string, string>[]
  weights: number[]
  col: ColumnInfo
}

// ── small helpers ──────────────────────────────────────────────────────────

const round1 = (x: number) => Math.round(x * 10) / 10

function isNum(v: string): boolean {
  return v !== "" && v != null && Number.isFinite(Number(v))
}

function allNumeric(values: string[]): boolean {
  return values.length > 0 && values.every(isNum)
}

function ageBand(n: number): string {
  if (!Number.isFinite(n)) return "Unknown"
  if (n < 18) return "Under 18"
  if (n < 25) return "18-24"
  if (n < 35) return "25-34"
  if (n < 45) return "35-44"
  if (n < 55) return "45-54"
  if (n < 65) return "55-64"
  return "65+"
}

function demoValueOf(row: Record<string, string>, spec: DemoSpec): string {
  const raw = (row[spec.key] ?? "").trim()
  if (raw === "") return "Unknown"
  if (spec.band) {
    const n = Number(raw)
    if (Number.isFinite(n)) return ageBand(n)
  }
  return raw
}

function colValues(rows: Record<string, string>[], key: string): string[] {
  const out: string[] = []
  for (const r of rows) {
    const v = (r[key] ?? "").trim()
    if (v !== "") out.push(v)
  }
  return out
}

// Effective sample size over a subset of rows (the ones that answered).
function effForIdx(idx: number[], weights: number[]): number {
  if (!idx.length) return 0
  let sum = 0
  let sumSq = 0
  for (const i of idx) {
    sum += weights[i]
    sumSq += weights[i] * weights[i]
  }
  return sumSq ? (sum * sum) / sumSq : idx.length
}

// ── parsing & classification ─────────────────────────────────────────────

function parseCsv(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(String(csvText || "").trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  })
  const headers = (res.meta.fields || []).map((h) => h.trim()).filter(Boolean)
  const rows = res.data
    .map((r) => {
      const o: Record<string, string> = {}
      for (const h of headers) o[h] = (r[h] ?? "").toString().trim()
      return o
    })
    .filter((r) => headers.some((h) => r[h] !== ""))
  return { headers, rows }
}

function classify(headers: string[], rows: Record<string, string>[]): ColumnInfo {
  const ignore: string[] = []
  const weightCols: string[] = []
  const demographics: DemoSpec[] = []
  const questionKeys: string[] = []
  for (const h of headers) {
    if (WEIGHT_RE.test(h)) {
      weightCols.push(h)
      continue
    }
    if (IGNORE_RE.test(h)) {
      ignore.push(h)
      continue
    }
    const def = DEMO_DEFS.find((d) => d.re.test(h))
    if (def) {
      let band = !!def.age
      if (def.age) band = allNumeric(colValues(rows, h))
      demographics.push({ key: h, label: def.label, band })
      continue
    }
    questionKeys.push(h)
  }
  return { ignore, weightCols, demographics, questionKeys }
}

// ── question type inference ────────────────────────────────────────────────

// Header phrasings that survey tools use for free-text fields.
const OPEN_HINT_RE =
  /(in your own words|please (specify|explain|describe)|other\s*\(.*specify.*\)|why do you|please elaborate|additional comments?|\bcomments?\b|open[- ]?ended|verbatim)/i

export function inferType(key: string, values: string[]): QuestionType {
  const distinct = Array.from(new Set(values))
  const hintNps = /(^|[^a-z])(nps|recommend)/i.test(key)

  // A clear open-ended header wins over option-set heuristics, but only for
  // text (a "please specify the number" field is still numeric).
  if (OPEN_HINT_RE.test(key) && !allNumeric(values)) return "open_ended"

  if (allNumeric(values)) {
    const nums = values.map(Number)
    const distinctNums = Array.from(new Set(nums))
    const allInt = nums.every((x) => Number.isInteger(x))
    const min = Math.min(...nums)
    const max = Math.max(...nums)
    if (hintNps && allInt && min >= 0 && max <= 10) return "nps"
    if (allInt && distinctNums.length <= 11 && min >= 0 && max - min <= 10) return "scale"
    return "numeric"
  }

  if (matchScale(distinct)) return "scale"
  if (distinct.length === 2) return "binary"

  const ratio = distinct.length / values.length
  const avgWords = values.reduce((s, v) => s + v.split(/\s+/).filter(Boolean).length, 0) / values.length
  if ((values.length >= 12 && ratio > 0.6) || avgWords > 6) return "open_ended"
  return "categorical"
}

// ── weighting ──────────────────────────────────────────────────────────────

function computeWeights(
  rows: Record<string, string>[],
  col: ColumnInfo,
  weighting?: WeightingConfig,
): { weights: number[]; weighted: boolean } {
  const n = rows.length
  if (!weighting?.enabled || !weighting.targets?.length) {
    return { weights: new Array(n).fill(1), weighted: false }
  }
  const specByKey = new Map(col.demographics.map((d) => [d.key, d]))
  const marginals: Record<string, Record<string, number>> = {}
  for (const t of weighting.targets) {
    if (!specByKey.has(t.dim)) continue
    const cleaned: Record<string, number> = {}
    let sum = 0
    for (const [k, v] of Object.entries(t.targets || {})) {
      const share = Number(v)
      if (Number.isFinite(share) && share > 0) {
        cleaned[k] = share
        sum += share
      }
    }
    if (sum > 0) {
      // Normalise shares to sum to 1 so users can enter percentages.
      for (const k of Object.keys(cleaned)) cleaned[k] /= sum
      marginals[t.dim] = cleaned
    }
  }
  if (!Object.keys(marginals).length) return { weights: new Array(n).fill(1), weighted: false }

  const valueFor = (dim: string, i: number) => demoValueOf(rows[i], specByKey.get(dim)!)
  const weights = rake(n, marginals, valueFor)
  return { weights, weighted: true }
}

// ── tabulation ───────────────────────────────────────────────────────────

interface Bucket {
  label: string
  count: number
  weighted: number
}

function bucketByValue(
  rows: Record<string, string>[],
  weights: number[],
  idx: number[],
  key: string,
  map: (raw: string) => string,
): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  for (const i of idx) {
    const label = map((rows[i][key] ?? "").trim())
    const b = buckets.get(label) || { label, count: 0, weighted: 0 }
    b.count += 1
    b.weighted += weights[i]
    buckets.set(label, b)
  }
  return buckets
}

function toOptions(buckets: Bucket[], weightedTotal: number): ToplineOption[] {
  return buckets.map((b) => ({
    label: b.label,
    count: b.count,
    weighted: b.weighted,
    pct: weightedTotal ? (b.weighted / weightedTotal) * 100 : 0,
  }))
}

const MAX_CAT_OPTIONS = 15

function tabulate(
  rows: Record<string, string>[],
  weights: number[],
  key: string,
  type: QuestionType,
): Question {
  const idx: number[] = []
  rows.forEach((r, i) => {
    if ((r[key] ?? "").trim() !== "") idx.push(i)
  })
  const answered = idx.length
  let weightedAnswered = 0
  for (const i of idx) weightedAnswered += weights[i]
  const moe = answered ? round1(98 / Math.sqrt(effForIdx(idx, weights))) : 0

  const base: Question = {
    key,
    prompt: key,
    type,
    answered,
    weightedAnswered,
    moe,
    options: [],
  }

  if (type === "open_ended") {
    const seen = new Set<string>()
    const samples: string[] = []
    for (const i of idx) {
      const v = (rows[i][key] ?? "").trim()
      const norm = v.toLowerCase()
      if (v && !seen.has(norm)) {
        seen.add(norm)
        samples.push(v)
      }
      if (samples.length >= 12) break
    }
    base.openSamples = samples
    base.openCount = answered
    return base
  }

  if (type === "numeric") {
    const nums = idx.map((i) => Number((rows[i][key] ?? "").trim())).filter((x) => Number.isFinite(x))
    base.numeric = numericStats(idx, rows, weights, key)
    base.histogram = histogram(idx, rows, weights, key, nums)
    return base
  }

  if (type === "nps") {
    const buckets = bucketByValue(rows, weights, idx, key, (raw) => {
      const v = Number(raw)
      if (v >= 9) return "Promoters (9-10)"
      if (v >= 7) return "Passives (7-8)"
      return "Detractors (0-6)"
    })
    const order = ["Detractors (0-6)", "Passives (7-8)", "Promoters (9-10)"]
    const ordered = order
      .map((l) => buckets.get(l) || { label: l, count: 0, weighted: 0 })
    const opts = toOptions(ordered, weightedAnswered)
    base.options = opts
    const promoters = opts[2]?.pct || 0
    const detractors = opts[0]?.pct || 0
    const passives = opts[1]?.pct || 0
    base.nps = {
      promoters: round1(promoters),
      passives: round1(passives),
      detractors: round1(detractors),
      score: Math.round(promoters - detractors),
    }
    base.numeric = numericStats(idx, rows, weights, key)
    return base
  }

  // categorical / binary / scale
  const buckets = bucketByValue(rows, weights, idx, key, (raw) => raw)
  const distinct = Array.from(buckets.keys())

  if (type === "scale") {
    const scale = matchScale(distinct)
    let orderedLabels: string[]
    let neutralIndex = -1
    if (scale) {
      orderedLabels = orderByScale(distinct, scale)
      neutralIndex = orderedLabels.findIndex((l) => isNeutralLabel(l))
    } else {
      // Numeric rating scale: order ascending, neutral = midpoint when odd.
      orderedLabels = distinct
        .map((l) => ({ l, n: Number(l) }))
        .sort((a, b) => a.n - b.n)
        .map((x) => x.l)
      if (orderedLabels.length % 2 === 1) neutralIndex = (orderedLabels.length - 1) / 2
      base.numeric = numericStats(idx, rows, weights, key)
    }
    const ordered = orderedLabels.map((l) => buckets.get(l) || { label: l, count: 0, weighted: 0 })
    base.options = toOptions(ordered, weightedAnswered)
    base.scaleMeta = { neutralIndex }
    return base
  }

  // categorical / binary: sort by weight desc, cap with an "Other" bucket
  let sorted = Array.from(buckets.values()).sort((a, b) => b.weighted - a.weighted)
  if (sorted.length > MAX_CAT_OPTIONS) {
    const head = sorted.slice(0, MAX_CAT_OPTIONS - 1)
    const tail = sorted.slice(MAX_CAT_OPTIONS - 1)
    const other: Bucket = {
      label: `Other (${tail.length})`,
      count: tail.reduce((s, b) => s + b.count, 0),
      weighted: tail.reduce((s, b) => s + b.weighted, 0),
    }
    sorted = [...head, other]
  }
  base.options = toOptions(sorted, weightedAnswered)
  return base
}

function numericStats(idx: number[], rows: Record<string, string>[], weights: number[], key: string) {
  const pairs = idx
    .map((i) => ({ x: Number((rows[i][key] ?? "").trim()), w: weights[i] }))
    .filter((p) => Number.isFinite(p.x))
  if (!pairs.length) return { mean: 0, median: 0, min: 0, max: 0, stdev: 0 }
  let wsum = 0
  let wx = 0
  for (const p of pairs) {
    wsum += p.w
    wx += p.w * p.x
  }
  const mean = wsum ? wx / wsum : 0
  const xs = pairs.map((p) => p.x).sort((a, b) => a - b)
  const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
  return {
    mean: round1(mean),
    median: round1(median),
    min: xs[0],
    max: xs[xs.length - 1],
    stdev: round1(Math.sqrt(variance)),
  }
}

function histogram(
  idx: number[],
  rows: Record<string, string>[],
  weights: number[],
  key: string,
  nums: number[],
): HistogramBin[] {
  if (!nums.length) return []
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const distinct = Array.from(new Set(nums))
  // One bin per integer value when the range is small.
  if (distinct.every((x) => Number.isInteger(x)) && max - min <= 12) {
    const bins: HistogramBin[] = []
    for (let v = min; v <= max; v++) {
      bins.push({ label: String(v), lo: v, hi: v, count: 0, weighted: 0, pct: 0 })
    }
    fillBins(bins, idx, rows, weights, key, (x) => x - min)
    return finalizeBins(bins)
  }
  const BIN_COUNT = 8
  const width = (max - min) / BIN_COUNT || 1
  const bins: HistogramBin[] = []
  for (let b = 0; b < BIN_COUNT; b++) {
    const lo = min + b * width
    const hi = b === BIN_COUNT - 1 ? max : lo + width
    bins.push({ label: `${round1(lo)}–${round1(hi)}`, lo, hi, count: 0, weighted: 0, pct: 0 })
  }
  fillBins(bins, idx, rows, weights, key, (x) => Math.min(BIN_COUNT - 1, Math.floor((x - min) / width)))
  return finalizeBins(bins)
}

function fillBins(
  bins: HistogramBin[],
  idx: number[],
  rows: Record<string, string>[],
  weights: number[],
  key: string,
  binOf: (x: number) => number,
) {
  for (const i of idx) {
    const x = Number((rows[i][key] ?? "").trim())
    if (!Number.isFinite(x)) continue
    const b = bins[binOf(x)]
    if (b) {
      b.count += 1
      b.weighted += weights[i]
    }
  }
}

function finalizeBins(bins: HistogramBin[]): HistogramBin[] {
  const total = bins.reduce((s, b) => s + b.weighted, 0)
  for (const b of bins) b.pct = total ? (b.weighted / total) * 100 : 0
  return bins
}

function buildDemographic(
  rows: Record<string, string>[],
  weights: number[],
  spec: DemoSpec,
): Demographic {
  const idx: number[] = []
  rows.forEach((_, i) => idx.push(i))
  const buckets = bucketByValue(rows, weights, idx, spec.key, (raw) =>
    raw === "" ? "Unknown" : demoValueOf({ [spec.key]: raw }, spec),
  )
  const total = Array.from(buckets.values()).reduce((s, b) => s + b.weighted, 0)
  let values = Array.from(buckets.values())
    .map((b) => ({ value: b.label, count: b.count, pct: total ? (b.weighted / total) * 100 : 0 }))
  // Age bands sort by cohort order; everything else by frequency.
  if (spec.label === "Age" && spec.band) {
    const ORDER = ["Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Unknown"]
    values = values.sort((a, b) => ORDER.indexOf(a.value) - ORDER.indexOf(b.value))
  } else {
    values = values.sort((a, b) => b.count - a.count)
  }
  return { key: spec.key, label: spec.label, values }
}

// ── public API ─────────────────────────────────────────────────────────────

export function buildAnalysis(
  csvText: string,
  name: string,
  weighting?: WeightingConfig,
): { analysis: Analysis; ctx: AnalysisContext } {
  const { headers, rows } = parseCsv(csvText)
  if (!rows.length) {
    throw new Error("No data rows found. The CSV needs a header row and at least one response row.")
  }
  const col = classify(headers, rows)
  const { weights, weighted } = computeWeights(rows, col, weighting)
  const effN = effectiveSampleSize(weights)

  const warnings: string[] = []
  if (!col.questionKeys.length) {
    warnings.push("No question columns detected — every column looked like an id or demographic field.")
  }
  if (!col.demographics.length) {
    warnings.push("No demographic columns detected, so crosstabs and weighting are unavailable. Add columns like age, gender, party, or region.")
  }
  if (col.weightCols.length) {
    warnings.push(`Ignored existing weight column${col.weightCols.length > 1 ? "s" : ""} (${col.weightCols.join(", ")}). Set targets below to rake in-tool.`)
  }
  if (weighting?.enabled && !weighted) {
    warnings.push("Weighting was requested but no usable targets were provided — showing unweighted results.")
  }

  const questions = col.questionKeys.map((key) => {
    const values = colValues(rows, key)
    const type = inferType(key, values)
    return tabulate(rows, weights, key, type)
  })

  const demographics = col.demographics.map((spec) => buildDemographic(rows, weights, spec))

  const analysis: Analysis = {
    name,
    n: rows.length,
    moe: effN ? round1(98 / Math.sqrt(effN)) : 0,
    weighted,
    effectiveN: Math.round(effN),
    questions,
    demographics,
    warnings,
  }
  return { analysis, ctx: { headers, rows, weights, col } }
}

const MAX_CROSSTAB_COLS = 10

export function buildCrosstab(ctx: AnalysisContext, questionKey: string, dim: string): Crosstab {
  const { rows, weights, col } = ctx
  const spec = col.demographics.find((d) => d.key === dim)
  if (!spec) throw new Error(`Unknown crosstab dimension: ${dim}`)

  const values = colValues(rows, questionKey)
  const type = inferType(questionKey, values)
  if (type === "numeric" || type === "open_ended") {
    throw new Error("Crosstabs aren't available for numeric or open-ended questions.")
  }

  // Recompute the question's row order from a full tabulation.
  const q = tabulate(rows, weights, questionKey, type)
  const rowLabels = q.options.map((o) => o.label)
  const rowOf = rowMapperFor(type)

  // Column buckets: top-N demographic values by weighted size, rest -> "Other".
  const idxAll: number[] = []
  rows.forEach((_, i) => idxAll.push(i))
  const colBuckets = bucketByValue(rows, weights, idxAll, dim, (raw) =>
    raw === "" ? "Unknown" : demoValueOf({ [dim]: raw }, spec),
  )
  let colNames = Array.from(colBuckets.values())
    .sort((a, b) => b.weighted - a.weighted)
    .map((b) => b.label)
  if (spec.label === "Age" && spec.band) {
    const ORDER = ["Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "Unknown"]
    colNames = colNames.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  }
  let otherCols: string[] = []
  if (colNames.length > MAX_CROSSTAB_COLS) {
    otherCols = colNames.slice(MAX_CROSSTAB_COLS)
    colNames = [...colNames.slice(0, MAX_CROSSTAB_COLS), "Other"]
  }
  const otherSet = new Set(otherCols)
  const colIndex = new Map(colNames.map((c, i) => [c, i]))
  const colFor = (i: number): number => {
    const v = demoValueOf(rows[i], spec)
    if (otherSet.has(v)) return colIndex.get("Other")!
    return colIndex.get(v) ?? -1
  }

  // weighted matrix[rowLabel][col]
  const matrix = new Map<string, number[]>()
  for (const l of rowLabels) matrix.set(l, new Array(colNames.length).fill(0))
  const columnTotals = new Array(colNames.length).fill(0)
  const rowTotals = new Map<string, number>()
  let grand = 0

  for (let i = 0; i < rows.length; i++) {
    const raw = (rows[i][questionKey] ?? "").trim()
    if (raw === "") continue
    const rl = rowOf(raw)
    const ci = colFor(i)
    if (ci < 0 || !matrix.has(rl)) continue
    const w = weights[i]
    matrix.get(rl)![ci] += w
    columnTotals[ci] += w
    rowTotals.set(rl, (rowTotals.get(rl) || 0) + w)
    grand += w
  }

  const outRows: CrosstabRow[] = rowLabels.map((label) => {
    const counts = matrix.get(label)!
    const allCount = rowTotals.get(label) || 0
    const allPct = grand ? (allCount / grand) * 100 : 0
    const cells = colNames.map((c, i) => {
      const colTot = columnTotals[i] || 0
      const count = counts[i]
      const pct = colTot ? (count / colTot) * 100 : 0
      const p = allPct / 100
      const m = colTot ? 1.96 * Math.sqrt((p * (1 - p)) / colTot) * 100 : 100
      const significant = colTot > 30 && Math.abs(pct - allPct) > m
      return { col: c, count, pct, significant, moe: m }
    })
    return { label, cells, all: { count: allCount, pct: allPct } }
  })

  return {
    questionKey,
    questionPrompt: q.prompt,
    dim,
    dimLabel: spec.label,
    columns: colNames,
    columnTotals,
    rows: outRows,
  }
}

// Maps a raw question answer to its crosstab row label (matching topline order).
function rowMapperFor(type: QuestionType): (raw: string) => string {
  if (type === "nps") {
    return (raw) => {
      const v = Number(raw)
      if (v >= 9) return "Promoters (9-10)"
      if (v >= 7) return "Passives (7-8)"
      return "Detractors (0-6)"
    }
  }
  return (raw) => raw
}

// Which questions can be crosstabbed (have a finite option set).
export function isCrosstabbable(q: Question): boolean {
  return q.type !== "numeric" && q.type !== "open_ended"
}

// Every crosstabbable question against every demographic dimension. Used by the
// PDF and Excel exports.
export function buildAllCrosstabs(ctx: AnalysisContext, analysis: Analysis): Crosstab[] {
  const out: Crosstab[] = []
  for (const q of analysis.questions) {
    if (!isCrosstabbable(q)) continue
    for (const d of analysis.demographics) {
      try {
        out.push(buildCrosstab(ctx, q.key, d.key))
      } catch {
        // Skip any combination the engine can't tabulate.
      }
    }
  }
  return out
}
