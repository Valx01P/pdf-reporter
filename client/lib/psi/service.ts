// Shared service used by every route handler. Assembles the run configuration
// (auto-detect + user overrides), runs the Pathway 3 pipeline, tabulates each
// substantive question under unweighted / RV / LV weights, and builds the
// display-safe client payload.

import { autoDetect, buildWeightMap, parseCsv, type ParsedCsv } from "./derive"
import { runPathway3 } from "./pipeline"
import { BANNER_DIMS, crosstab as buildCrosstab, demoValue, tabulateQuestion } from "./tabulate"
import { buildTabbook as assembleTabbook, DEMO_BANNER } from "./tabbook"
import {
  CPS_DNV_SHARE,
  HISTORY_K,
  PROJECTED_TURNOUT,
  PROJECTED_VOTERS,
  REGISTERED_VOTERS,
  Q3_MOTIVATION,
  Q4_PREPAREDNESS,
  Q5_SOCIAL,
  SET_A_TARGETS,
  type TargetSet,
} from "./constants"
import { runUncertainty, type UncertaintyResult } from "./uncertainty"
import type { Crosstab, Question, Tabbook } from "../types"
import type {
  ColumnMapping,
  Diagnostics,
  DimensionTargets,
  LvResult,
  PipelineResult,
  QualityReport,
  RakeLog,
  ShiftRow,
  SocalAudit,
} from "./types"

export interface RunConfig {
  name?: string
  mapping?: Partial<ColumnMapping>
  weightingSet?: "A" | "B" | "C"
  voters?: number
  registered?: number
  k?: { consistent: number; occasional: number; new: number }
  q3Map?: Record<string, number>
  q4Map?: Record<string, number>
  q5Map?: Record<string, number>
  baseTargets?: TargetSet
  cpsDnv?: number
  // When set, RV/LV are raked to these user variables + targets instead of Set A/B/C.
  customWeighting?: { key: string; label?: string; isDemo: boolean; targets: Record<string, number> }[]
}

export interface FullResult {
  parsed: ParsedCsv
  mapping: ColumnMapping
  substantiveKeys: string[]
  q3Map: Record<string, number>
  q4Map: Record<string, number>
  q5Map: Record<string, number>
  projectedTurnout: number
  k: { consistent: number; occasional: number; new: number }
  weightingSet: "A" | "B" | "C"
  baseTargets: TargetSet
  cpsDnv: number
  customWeighting?: RunConfig["customWeighting"]
  result: PipelineResult
}

// Anchored so it only catches bookkeeping COLUMNS, never substantive questions
// whose text happens to contain "date" (candidate), "time" (sometimes), etc.
const ID_DUR_RE =
  /^(respondent_?id|resp_?id|.*_id|id|uuid|guid|row_?id|record_?id|index|seq|timestamp|datetime|date|time|start(ed)?|end(ed)?|submitted(_?at)?|created_?at|completed_?at|duration(_?sec(onds)?)?|loi|completion(_?time)?|phone|mobile|cell|email|e_?mail|name|first_?name|last_?name|ip|ip_?address|user_?agent|weight|weights|wt|final_?weight)$/i

export function runAnalysis(csvText: string, config: RunConfig): FullResult {
  const parsed = parseCsv(csvText)
  if (!parsed.rows.length) throw new Error("No data rows found. The CSV needs a header row and at least one response row.")

  const mapping: ColumnMapping = { ...autoDetect(parsed), ...stripEmpty(config.mapping) }
  const mapped = new Set(Object.values(mapping).filter(Boolean) as string[])
  const substantiveKeys = parsed.headers.filter(
    (h) => !mapped.has(h) && !ID_DUR_RE.test(h) && !isIdLike(parsed.rows, h),
  )

  const q3Map = config.q3Map || buildWeightMap(parsed.rows, mapping.q3, Q3_MOTIVATION)
  const q4Map = config.q4Map || buildWeightMap(parsed.rows, mapping.q4, Q4_PREPAREDNESS)
  const q5Map = config.q5Map || buildWeightMap(parsed.rows, mapping.q5, Q5_SOCIAL)
  const projectedTurnout =
    config.voters && config.registered ? config.voters / config.registered : config.voters ? config.voters / REGISTERED_VOTERS : PROJECTED_TURNOUT
  const k = config.k || HISTORY_K
  const weightingSet = config.weightingSet || "A"
  const baseTargets = config.baseTargets || SET_A_TARGETS

  const result = runPathway3({
    name: config.name || "Untitled survey",
    parsed,
    mapping,
    substantiveKeys,
    lvConfig: { q3Map, q4Map, q5Map, k, projectedTurnout },
    baseTargets,
    weightingSet,
    cpsDnv: config.cpsDnv,
    customWeighting: config.customWeighting,
  })

  return { parsed, mapping, substantiveKeys, q3Map, q4Map, q5Map, projectedTurnout, k, weightingSet, baseTargets, cpsDnv: config.cpsDnv ?? CPS_DNV_SHARE, customWeighting: config.customWeighting, result }
}

export function buildUncertainty(full: FullResult, bootstrap?: number): UncertaintyResult {
  const r = full.result
  const out = runUncertainty(
    {
      derived: r.derived,
      rows: full.parsed.rows,
      substantiveKeys: full.substantiveKeys,
      baseTargets: full.baseTargets,
      lvConfig: { q3Map: full.q3Map, q4Map: full.q4Map, q5Map: full.q5Map, k: full.k, projectedTurnout: full.projectedTurnout },
      weightingSet: full.weightingSet,
      rvWeights: r.rv.weights,
      lvWeights: r.lvUniverse.weights,
      baseRvTargets: r.rv.targets,
      baseLvTargets: r.lvUniverse.targets,
      lvPvote: r.lv.pvote,
      cpsDnv: full.cpsDnv,
      customWeighting: full.customWeighting,
    },
    { bootstrap },
  )
  return out
}

export interface QuestionToplines {
  key: string
  prompt: string
  type: Question["type"]
  unweighted: Question
  rv: Question
  lv: Question
}

export function buildToplines(full: FullResult): QuestionToplines[] {
  const { parsed, result, substantiveKeys } = full
  const unit = new Array(result.derived.length).fill(1)
  return substantiveKeys.map((key) => {
    const unweighted = tabulateQuestion(parsed.rows, result.derived, unit, key)
    return {
      key,
      prompt: key,
      type: unweighted.type,
      unweighted,
      rv: tabulateQuestion(parsed.rows, result.derived, result.rv.weights, key),
      lv: tabulateQuestion(parsed.rows, result.derived, result.lvUniverse.weights, key),
    }
  })
}

export interface ClientPayload {
  name: string
  headers: string[]
  mapping: ColumnMapping
  substantiveKeys: string[]
  bannerDims: { key: string; label: string; isDemo: boolean }[]
  tabbookDims: { key: string; label: string }[] // demographic banner groups for the Tabbook
  // Variables the user can weight on, with observed % per category (UI prefill).
  weightingVariables: { key: string; label: string; isDemo: boolean; categories: { value: string; label: string; pct: number }[] }[]
  quality: QualityReport
  warnings: string[]
  weightingSet: "A" | "B" | "C"
  lv: {
    model: Omit<LvResult, "raw" | "pvote">
    projectedTurnout: number
    voters: number
    registered: number
    k: { consistent: number; occasional: number; new: number }
    q3Map: Record<string, number>
    q4Map: Record<string, number>
    q5Map: Record<string, number>
  }
  rv: { diagnostics: Diagnostics; rakeLog: RakeLog; recall: { stage: string; note: string }[]; targets: DimensionTargets }
  lvUniverse: { diagnostics: Diagnostics; rakeLog: RakeLog; recall: { stage: string; note: string }[]; targets: DimensionTargets }
  socal: SocalAudit
  shift: { dimension: string; rows: ShiftRow[] }[]
  toplines: QuestionToplines[]
  composition: { key: string; label: string; values: { value: string; unweighted: number; rv: number; lv: number }[] }[]
}

export function buildClientPayload(full: FullResult): ClientPayload {
  const { parsed, mapping, substantiveKeys, result, weightingSet } = full
  const { raw, pvote, ...model } = result.lv

  // A demographic dim is shown only when the CSV actually populated it, so
  // Income/Party collapse away on datasets that lack those columns.
  const populated = (key: string) => result.derived.some((d) => {
    const v = demoValue(d, key)
    return v !== "" && v !== "Unknown"
  })

  // Banner dims: demographic dimensions + the substantive questions themselves.
  const bannerDims = [
    ...BANNER_DIMS.filter((d) => populated(d.key)).map((d) => ({ key: d.key, label: d.label, isDemo: true })),
    ...substantiveKeys.map((k) => ({ key: k, label: shorten(k), isDemo: false })),
  ]

  // Sample composition per demographic banner (unweighted vs RV vs LV).
  const unit = new Array(result.derived.length).fill(1)
  const composition = BANNER_DIMS.filter((d) => populated(d.key)).map((d) => {
    const tally = (w: number[]) => {
      const s: Record<string, number> = {}
      let t = 0
      result.derived.forEach((dr, i) => {
        const v = demoValue(dr, d.key)
        s[v] = (s[v] || 0) + w[i]
        t += w[i]
      })
      return { s, t }
    }
    const u = tally(unit)
    const rv = tally(result.rv.weights)
    const lv = tally(result.lvUniverse.weights)
    const values = Object.keys(u.s)
      .map((v) => ({
        value: v,
        unweighted: u.t ? (u.s[v] / u.t) * 100 : 0,
        rv: rv.t ? ((rv.s[v] || 0) / rv.t) * 100 : 0,
        lv: lv.t ? ((lv.s[v] || 0) / lv.t) * 100 : 0,
      }))
      .sort((a, b) => b.unweighted - a.unweighted)
    return { key: d.key, label: d.label, values }
  })

  // Weighting variables for the custom-weighting UI: populated demographics +
  // categorical survey columns (2–12 distinct answers), each with observed %.
  const r1 = (x: number) => Math.round(x * 10) / 10
  const demoVars = composition.map((c) => ({
    key: c.key,
    label: c.label,
    isDemo: true,
    categories: c.values.map((v) => ({ value: v.value, label: v.value, pct: r1(v.unweighted) })),
  }))
  const surveyVars = substantiveKeys
    .map((key) => {
      const counts = new Map<string, number>()
      let answered = 0
      for (const d of result.derived) {
        const v = (parsed.rows[d.i][key] ?? "").trim()
        if (!v) continue
        counts.set(v, (counts.get(v) || 0) + 1)
        answered++
      }
      return { key, counts, answered }
    })
    // Keep real questions, drop indicator columns: 2–12 categories, answered by
    // ≥half the sample, and no single value dominating ≥95% (DMA / language 0/1
    // flags are ~99% one value; lopsided real questions like Groyper stay).
    .filter((s) => {
      if (s.counts.size < 2 || s.counts.size > 12) return false
      if (s.answered < result.derived.length * 0.5) return false
      const top = Math.max(...s.counts.values())
      return top / s.answered < 0.95
    })
    .map((s) => ({
      key: s.key,
      label: shorten(s.key),
      isDemo: false,
      categories: Array.from(s.counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value, c]) => ({ value, label: value, pct: r1((c / s.answered) * 100) })),
    }))
  const weightingVariables = [...demoVars, ...surveyVars]

  return {
    name: result.name,
    headers: parsed.headers,
    mapping,
    substantiveKeys,
    bannerDims,
    tabbookDims: DEMO_BANNER.filter((d) => populated(d.key)).map((d) => ({ key: d.key, label: d.group })),
    weightingVariables,
    quality: result.quality,
    warnings: result.warnings,
    weightingSet,
    lv: {
      model,
      projectedTurnout: full.projectedTurnout,
      voters: Math.round(full.projectedTurnout * REGISTERED_VOTERS),
      registered: REGISTERED_VOTERS,
      k: full.k,
      q3Map: full.q3Map,
      q4Map: full.q4Map,
      q5Map: full.q5Map,
    },
    rv: { diagnostics: result.rv.diagnostics, rakeLog: result.rv.rakeLog, recall: result.rv.recall, targets: result.rv.targets },
    lvUniverse: { diagnostics: result.lvUniverse.diagnostics, rakeLog: result.lvUniverse.rakeLog, recall: result.lvUniverse.recall, targets: result.lvUniverse.targets },
    socal: result.socal,
    shift: result.shift,
    toplines: buildToplines(full),
    composition,
  }
}

export function buildOneCrosstab(
  full: FullResult,
  questionKey: string,
  banner: { key: string; label: string; isDemo: boolean },
  universe: "RV" | "LV",
): Crosstab {
  const weights = universe === "RV" ? full.result.rv.weights : full.result.lvUniverse.weights
  return buildCrosstab(full.parsed.rows, full.result.derived, weights, questionKey, banner)
}

// Crosstabbable substantive questions × demographic banners, in one universe.
// `dimKeys` narrows the banners (the PDF/Excel use a focused set; pass nothing
// for all). Used by the PDF and Excel appendices.
export function buildAllCrosstabs(full: FullResult, universe: "RV" | "LV" = "RV", dimKeys?: string[]): Crosstab[] {
  const weights = universe === "RV" ? full.result.rv.weights : full.result.lvUniverse.weights
  const dims = dimKeys ? BANNER_DIMS.filter((d) => dimKeys.includes(d.key)) : BANNER_DIMS
  const out: Crosstab[] = []
  for (const key of full.substantiveKeys) {
    const probe = tabulateQuestion(full.parsed.rows, full.result.derived, weights, key)
    if (probe.type === "numeric" || probe.type === "open_ended") continue
    for (const d of dims) {
      try {
        out.push(buildCrosstab(full.parsed.rows, full.result.derived, weights, key, { key: d.key, label: d.label, isDemo: true }))
      } catch {
        /* skip */
      }
    }
  }
  return out
}

// The full Tabbook for one universe: every question's Total + all banner groups
// in one wide grid. `banners` defaults to the demographic banner; pass a custom
// list (e.g. add question columns) to override.
export function buildTabbook(
  full: FullResult,
  universe: "RV" | "LV" = "RV",
  banners?: { key: string; isDemo: boolean }[],
): Tabbook {
  const weights = universe === "RV" ? full.result.rv.weights : full.result.lvUniverse.weights
  const bs = banners && banners.length ? banners : DEMO_BANNER.map((d) => ({ key: d.key, isDemo: true }))
  return assembleTabbook(full.parsed.rows, full.result.derived, weights, full.substantiveKeys, universe, full.result.name, bs)
}

export interface BalanceRow {
  variable: string // raking dimension label
  category: string
  target: number // target %
  weighted: number // achieved weighted %
  diff: number // weighted - target (pp)
  smd: number // standardized mean difference
  balanced: boolean // |SMD| < 0.10
}

// Covariate balance after weighting: achieved weighted share vs the raking target
// per category, with the per-cell SMD. Mirrors the reference Weight Diagnostics
// "Covariate Balance" section for one universe.
export function buildBalance(full: FullResult, universe: "RV" | "LV"): BalanceRow[] {
  const u = universe === "RV" ? full.result.rv : full.result.lvUniverse
  const weights = u.weights
  const targets = u.targets
  const dims: { key: keyof DimensionTargets; label: string }[] = [
    { key: "ageSex", label: "AgeGender" },
    { key: "raceEdu", label: "RaceEdu" },
    { key: "eduSex", label: "GenderEdu" },
    { key: "region", label: "Region" },
    { key: "recall2024", label: "Vote2024_Bucket" },
  ]
  const cellOf: Record<string, (d: (typeof full.result.derived)[number]) => string> = {
    ageSex: (d) => d.ageSex,
    raceEdu: (d) => d.raceEdu,
    eduSex: (d) => d.eduSex,
    region: (d) => d.region,
    recall2024: (d) => d.recall,
  }
  const out: BalanceRow[] = []
  let totalW = 0
  for (const w of weights) totalW += w
  for (const { key, label } of dims) {
    const tgt = targets[key]
    if (!tgt) continue
    const achieved: Record<string, number> = {}
    full.result.derived.forEach((d, i) => {
      const cell = cellOf[key](d)
      achieved[cell] = (achieved[cell] || 0) + weights[i]
    })
    for (const [cat, t] of Object.entries(tgt)) {
      const wpct = totalW ? ((achieved[cat] || 0) / totalW) * 100 : 0
      const diff = wpct - t
      const p = t / 100
      const sd = Math.sqrt(p * (1 - p)) * 100 || 1
      const smd = Math.abs(diff) / sd
      out.push({ variable: label, category: cat.replace(/ · /g, " "), target: t, weighted: wpct, diff, smd, balanced: smd < 0.1 })
    }
  }
  return out
}

// An identifier-like column: every value distinct AND either numeric or a short
// single token. Distinguishes ids ("resp", "P100023", row numbers) from genuine
// open-ended text, which is all-distinct but multi-word / long.
function isIdLike(rows: Record<string, string>[], header: string): boolean {
  const vals = rows.map((r) => (r[header] ?? "").trim()).filter(Boolean)
  if (vals.length < 8) return false
  const distinct = new Set(vals)
  if (distinct.size < vals.length * 0.95) return false // not (near-)unique → real answers
  const allNumeric = vals.every((v) => Number.isFinite(Number(v)))
  const avgWords = vals.reduce((s, v) => s + v.split(/\s+/).filter(Boolean).length, 0) / vals.length
  const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length
  return allNumeric || (avgWords <= 1.2 && avgLen < 16)
}

function stripEmpty(m?: Partial<ColumnMapping>): Partial<ColumnMapping> {
  if (!m) return {}
  const out: Partial<ColumnMapping> = {}
  for (const [k, v] of Object.entries(m)) if (v) (out as Record<string, string>)[k] = v
  return out
}

function shorten(s: string): string {
  return s.length > 40 ? s.slice(0, 39) + "…" : s
}

export { PROJECTED_VOTERS, REGISTERED_VOTERS }
