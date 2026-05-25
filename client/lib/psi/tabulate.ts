// Weighted tabulation of substantive questions for one universe. Operates on
// the kept respondents (DerivedRespondent carries the original row index) and a
// weight vector aligned to them. Produces the display-friendly Question and
// Crosstab shapes from lib/types so the existing charts and PDF reuse directly.

import { inferType } from "../analyze"
import { matchScale, orderByScale, isNeutralLabel } from "../scales"
import type { Crosstab, CrosstabRow, Question, QuestionType, ToplineOption } from "../types"
import type { DerivedRespondent } from "./types"

const round1 = (x: number) => Math.round(x * 10) / 10

// Demographic banner dimensions available for crosstabs, beyond raw question columns.
export const BANNER_DIMS = [
  { key: "ageBucket", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "ageSex", label: "Age × Sex" },
  { key: "edu", label: "Education" },
  { key: "raceEdu", label: "Race × Education" },
  { key: "income", label: "Income" },
  { key: "region", label: "Region" },
  { key: "party", label: "Party" },
  { key: "recall", label: "2024 recall" },
  { key: "historyBucket", label: "Vote history" },
] as const

export function demoValue(d: DerivedRespondent, key: string): string {
  const v = (d as unknown as Record<string, string>)[key]
  return v == null || v === "" ? "Unknown" : String(v)
}

function effectiveN(idx: number[], weights: number[]): number {
  let s = 0
  let sq = 0
  for (const i of idx) {
    s += weights[i]
    sq += weights[i] * weights[i]
  }
  return sq ? (s * s) / sq : idx.length
}

export function tabulateQuestion(
  rows: Record<string, string>[],
  derived: DerivedRespondent[],
  weights: number[],
  key: string,
): Question {
  const idx: number[] = []
  derived.forEach((d, k) => {
    if ((rows[d.i][key] ?? "").trim() !== "") idx.push(k)
  })
  const values = idx.map((k) => (rows[derived[k].i][key] ?? "").trim())
  const type: QuestionType = inferType(key, values)
  let weightedAnswered = 0
  for (const k of idx) weightedAnswered += weights[k]
  const moe = idx.length ? round1(98 / Math.sqrt(effectiveN(idx, weights))) : 0

  const base: Question = {
    key,
    prompt: key,
    type,
    answered: idx.length,
    weightedAnswered,
    moe,
    options: [],
  }

  if (type === "open_ended") {
    const seen = new Set<string>()
    const samples: string[] = []
    for (const k of idx) {
      const v = (rows[derived[k].i][key] ?? "").trim()
      const n = v.toLowerCase()
      if (v && !seen.has(n)) {
        seen.add(n)
        samples.push(v)
      }
      if (samples.length >= 12) break
    }
    base.openSamples = samples
    base.openCount = idx.length
    return base
  }

  if (type === "numeric") {
    const pairs = idx
      .map((k) => ({ x: Number((rows[derived[k].i][key] ?? "").trim()), w: weights[k] }))
      .filter((p) => Number.isFinite(p.x))
    if (pairs.length) {
      let wsum = 0
      let wx = 0
      for (const p of pairs) {
        wsum += p.w
        wx += p.w * p.x
      }
      const xs = pairs.map((p) => p.x).sort((a, b) => a - b)
      const mean = wsum ? wx / wsum : 0
      const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2
      const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
      base.numeric = { mean: round1(mean), median: round1(median), min: xs[0], max: xs[xs.length - 1], stdev: round1(Math.sqrt(variance)) }
    }
    return base
  }

  // bucket
  const buckets = new Map<string, { count: number; weighted: number }>()
  for (const k of idx) {
    const label = (rows[derived[k].i][key] ?? "").trim()
    const b = buckets.get(label) || { count: 0, weighted: 0 }
    b.count++
    b.weighted += weights[k]
    buckets.set(label, b)
  }
  const distinct = Array.from(buckets.keys())
  const toOpts = (labels: string[]): ToplineOption[] =>
    labels.map((l) => {
      const b = buckets.get(l) || { count: 0, weighted: 0 }
      return { label: l, count: b.count, weighted: b.weighted, pct: weightedAnswered ? (b.weighted / weightedAnswered) * 100 : 0 }
    })

  if (type === "scale") {
    const scale = matchScale(distinct)
    let ordered: string[]
    let neutralIndex = -1
    if (scale) {
      ordered = orderByScale(distinct, scale)
      neutralIndex = ordered.findIndex((l) => isNeutralLabel(l))
    } else {
      ordered = distinct.map((l) => ({ l, n: Number(l) })).sort((a, b) => a.n - b.n).map((x) => x.l)
      if (ordered.length % 2 === 1) neutralIndex = (ordered.length - 1) / 2
    }
    base.options = toOpts(ordered)
    base.scaleMeta = { neutralIndex }
    return base
  }

  base.options = toOpts(distinct.sort((a, b) => (buckets.get(b)!.weighted - buckets.get(a)!.weighted)))
  return base
}

// Crosstab: question (stub, rows) × banner (columns). Banner may be a demographic
// dimension key (BANNER_DIMS) or another question column. Column percentages
// with 95%-CI significance flags vs the row's overall share.
export function crosstab(
  rows: Record<string, string>[],
  derived: DerivedRespondent[],
  weights: number[],
  questionKey: string,
  banner: { key: string; label: string; isDemo: boolean },
): Crosstab {
  const q = tabulateQuestion(rows, derived, weights, questionKey)
  const rowLabels = q.options.map((o) => o.label)
  const bannerValue = (k: number): string =>
    banner.isDemo ? demoValue(derived[k], banner.key) : (rows[derived[k].i][banner.key] ?? "").trim() || "Unknown"

  // columns by weighted size, capped at 10 (+ Other)
  const colW = new Map<string, number>()
  derived.forEach((_, k) => {
    if ((rows[derived[k].i][questionKey] ?? "").trim() === "") return
    const c = bannerValue(k)
    colW.set(c, (colW.get(c) || 0) + weights[k])
  })
  let columns = Array.from(colW.entries()).sort((a, b) => b[1] - a[1]).map(([c]) => c)
  let otherSet = new Set<string>()
  if (columns.length > 10) {
    otherSet = new Set(columns.slice(10))
    columns = [...columns.slice(0, 10), "Other"]
  }
  const colIndex = new Map(columns.map((c, i) => [c, i]))
  const colFor = (c: string) => (otherSet.has(c) ? colIndex.get("Other")! : colIndex.get(c) ?? -1)

  const matrix = new Map<string, number[]>()
  for (const l of rowLabels) matrix.set(l, new Array(columns.length).fill(0))
  const columnTotals = new Array(columns.length).fill(0)
  const rowTotals = new Map<string, number>()
  let grand = 0

  derived.forEach((d, k) => {
    const raw = (rows[d.i][questionKey] ?? "").trim()
    if (raw === "") return
    if (!matrix.has(raw)) return
    const ci = colFor(bannerValue(k))
    if (ci < 0) return
    const w = weights[k]
    matrix.get(raw)![ci] += w
    columnTotals[ci] += w
    rowTotals.set(raw, (rowTotals.get(raw) || 0) + w)
    grand += w
  })

  const outRows: CrosstabRow[] = rowLabels.map((label) => {
    const counts = matrix.get(label)!
    const allCount = rowTotals.get(label) || 0
    const allPct = grand ? (allCount / grand) * 100 : 0
    const cells = columns.map((c, i) => {
      const colTot = columnTotals[i] || 0
      const pct = colTot ? (counts[i] / colTot) * 100 : 0
      const p = allPct / 100
      const m = colTot ? 1.96 * Math.sqrt((p * (1 - p)) / colTot) * 100 : 100
      return { col: c, count: counts[i], pct, significant: colTot > 30 && Math.abs(pct - allPct) > m, moe: m }
    })
    return { label, cells, all: { count: allCount, pct: allPct } }
  })

  return {
    questionKey,
    questionPrompt: q.prompt,
    dim: banner.key,
    dimLabel: banner.label,
    columns,
    columnTotals,
    rows: outRows,
  }
}
