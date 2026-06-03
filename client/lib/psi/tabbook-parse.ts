// Inverse of lib/exports.ts:buildTabbookCsv. Reads an already-processed *tabbook*
// CSV (aggregate crosstab output — NOT respondent-level data) back into a Tabbook
// object so it can be viewed and re-exported. Every number comes straight from the
// file; nothing is invented. Significance flags and net rows are re-derived from
// the reported percentages with the same formulas the generator uses, so a
// round-trip (parse ∘ buildTabbookCsv) reproduces the original grid.

import Papa from "papaparse"
import { summaryRowsFor } from "./tabbook"
import type { QuestionType, Tabbook, TabbookColumn, TabbookGroup, TabbookRow } from "../types"

// Banner rows the generator emits for every question block. Used both to detect
// the format and to skip the repeated banner while walking question blocks.
const RESPONSE_MARK = "response"
const N_MARK = "(unweighted n)"

function splitRows(csvText: string): string[][] {
  const clean = String(csvText || "").replace(/^﻿/, "").trim()
  const res = Papa.parse<string[]>(clean, { header: false, skipEmptyLines: false })
  return (res.data || []).map((r) => (Array.isArray(r) ? r.map((c) => (c ?? "").toString()) : []))
}

const cell = (row: string[] | undefined, i: number) => (row?.[i] ?? "").trim()
const isBlankRow = (row: string[]) => row.every((c) => (c ?? "").trim() === "")

// A percentage cell ("42.1%") -> 42.1; a bare number ("3.81") -> 3.81; else null.
function parseValue(raw: string): number | null {
  const s = (raw ?? "").trim().replace(/%$/, "").replace(/,/g, "")
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ── detection ───────────────────────────────────────────────────────────────

// True when the upload is an aggregate tabbook export rather than respondent rows.
// The signature is specific: a "Response" column-header row immediately followed
// by an "(unweighted n)" row, with percentage cells beneath. Respondent CSVs do
// not carry that pair, so this won't misfire on real survey data.
export function looksLikeTabbook(csvText: string): boolean {
  const rows = splitRows(csvText)
  for (let i = 0; i < rows.length - 1; i++) {
    if (cell(rows[i], 0).toLowerCase() === RESPONSE_MARK && cell(rows[i + 1], 0).toLowerCase() === N_MARK) {
      // Require at least one banner column and a percentage somewhere below.
      const hasCols = rows[i].slice(1).some((c) => c.trim() !== "")
      const hasPct = rows.slice(i + 2, i + 8).some((r) => r.slice(1).some((c) => /%/.test(c)))
      if (hasCols && hasPct) return true
    }
  }
  return false
}

// ── parsing ───────────────────────────────────────────────────────────────

// Labels the generator writes as net/summary rows beneath the options. They are
// dropped here and re-derived from the parsed options so they don't pollute the
// option list. Exact-match against summaryRowsFor's output labels.
const SUMMARY_LABELS = new Set([
  "approve", "disapprove", "more likely", "less likely", "republican total", "democrat total",
])
const isSummaryLabel = (label: string) => {
  const l = label.trim().toLowerCase()
  return l.startsWith("net (") || SUMMARY_LABELS.has(l)
}

interface Banner {
  columns: TabbookColumn[]
  groups: TabbookGroup[]
}

// Build the shared column/group set from the first question's banner rows.
function parseBanner(groupRow: string[], colHeaderRow: string[], nRow: string[]): Banner {
  // Column labels live from index 1 onward (index 0 is the "Response" label cell).
  // Trim trailing empties the spreadsheet pads rows with.
  let lastCol = 0
  for (let i = 1; i < colHeaderRow.length; i++) if (cell(colHeaderRow, i) !== "") lastCol = i

  const columns: TabbookColumn[] = []
  let curGroup = "Total"
  for (let i = 1; i <= lastCol; i++) {
    const label = cell(colHeaderRow, i)
    if (label === "") continue
    const g = cell(groupRow, i)
    if (g !== "") curGroup = g
    const isTotal = i === 1 && label.toLowerCase() === "total"
    const nRaw = parseValue(cell(nRow, i))
    columns.push({
      group: isTotal ? "Total" : curGroup,
      groupKey: isTotal ? "__total__" : slug(curGroup),
      label,
      value: label,
      isTotal,
      unweightedN: nRaw != null ? Math.round(nRaw) : 0,
    })
  }

  // The Total column's (unweighted n) is left blank by the generator. Infer it as
  // the size of the first real banner group (its categories partition the sample).
  const totalCol = columns.find((c) => c.isTotal)
  if (totalCol && totalCol.unweightedN === 0) {
    const firstGroup = columns.find((c) => !c.isTotal)?.groupKey
    if (firstGroup) {
      totalCol.unweightedN = columns
        .filter((c) => c.groupKey === firstGroup)
        .reduce((s, c) => s + c.unweightedN, 0)
    }
  }

  // Collapse the flat column list into grouped header spans (Total first).
  const groups: TabbookGroup[] = []
  for (const c of columns) {
    const last = groups[groups.length - 1]
    if (last && last.label === c.group) last.span += 1
    else groups.push({ label: c.group, span: 1 })
  }
  return { columns, groups }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "g"
}

// Re-derive the 95%-CI significance flag for a row against its Total share, using
// the reported percentages and each column's (unweighted n) as the base.
function significanceFor(pct: number[], cols: TabbookColumn[]): boolean[] {
  const totalPct = pct[0] ?? 0
  const p = totalPct / 100
  return cols.map((col, ci) => {
    if (col.isTotal || col.unweightedN <= 30) return false
    const m = 1.96 * Math.sqrt((p * (1 - p)) / col.unweightedN) * 100
    return Math.abs((pct[ci] ?? 0) - totalPct) > m
  })
}

// Parse one question block's answer rows into TabbookRows, dropping summary rows.
function parseQuestion(prompt: string, answerRows: string[][], banner: Banner) {
  const ncol = banner.columns.length
  const rows: TabbookRow[] = []
  let isRank = false
  let noteText = ""

  for (const r of answerRows) {
    const label = cell(r, 0)
    if (label === "" || isSummaryLabel(label)) continue
    // Cells align to columns from index 1; index 1 is the Total column.
    const values: number[] = []
    let anyPct = false
    let anyVal = false
    for (let ci = 0; ci < ncol; ci++) {
      const raw = cell(r, ci + 1)
      if (/%/.test(raw)) anyPct = true
      const v = parseValue(raw)
      if (v != null) anyVal = true
      values.push(v ?? 0)
    }
    if (!anyVal) {
      // A lone text row with no numbers is the note for a numeric/open question.
      noteText = label
      continue
    }
    if (!anyPct) isRank = true
    rows.push({ label, pct: values, significant: significanceFor(values, banner.columns) })
  }

  let type: QuestionType = "categorical"
  if (rows.length === 0) type = noteText ? "open_ended" : "categorical"

  return {
    key: prompt,
    prompt,
    type,
    rows,
    valueFormat: isRank ? ("rank" as const) : undefined,
    note: rows.length === 0 && noteText ? noteText : undefined,
    summary: isRank ? undefined : summaryRowsFor(rows, ncol),
  }
}

// Parse a full tabbook CSV into a Tabbook. `universe` is taken from the file name
// when it ends in -rv/-lv, defaulting to RV.
export function parseTabbookCsv(csvText: string, fallbackName = "Tabbook"): Tabbook {
  const rows = splitRows(csvText)

  // Name from the "Survey name:" preamble, else the fallback (upload file name).
  let name = fallbackName
  let start = 0
  if (cell(rows[0], 0).toLowerCase() === "survey name:") {
    name = cell(rows[1], 0) || fallbackName
    start = 2
  }

  // Locate the shared banner from the first Response/(unweighted n) pair.
  const respIdx = rows.findIndex(
    (r, i) => cell(r, 0).toLowerCase() === RESPONSE_MARK && cell(rows[i + 1], 0).toLowerCase() === N_MARK,
  )
  if (respIdx < 1) throw new Error("This doesn't look like a tabbook export — no banner header row was found.")
  const banner = parseBanner(rows[respIdx - 1], rows[respIdx], rows[respIdx + 1])

  // Walk question blocks: prompt row, (skip group/Response/n), answer rows, blanks.
  const questions: ReturnType<typeof parseQuestion>[] = []
  let i = start
  while (i < rows.length) {
    while (i < rows.length && isBlankRow(rows[i])) i++
    if (i >= rows.length) break
    const prompt = cell(rows[i], 0)
    i++
    // Advance to this block's Response row, skipping the group banner row.
    while (i < rows.length && cell(rows[i], 0).toLowerCase() !== RESPONSE_MARK && !isBlankRow(rows[i])) i++
    if (i >= rows.length || cell(rows[i], 0).toLowerCase() !== RESPONSE_MARK) continue
    i++ // past Response
    if (cell(rows[i], 0).toLowerCase() === N_MARK) i++ // past (unweighted n)
    const answerRows: string[][] = []
    while (i < rows.length && !isBlankRow(rows[i])) answerRows.push(rows[i++])
    if (prompt) questions.push(parseQuestion(prompt, answerRows, banner))
  }

  // Universe drives only the display badge and export suffix. The survey-name
  // preamble is often shared across both universes, so consult the upload file
  // name too (it usually carries an -RV / -LV marker).
  const universe = /[-_ ]lv\b|\blikely/i.test(`${name} ${fallbackName}`) ? "LV" : "RV"
  return { name, universe, groups: banner.groups, columns: banner.columns, questions }
}
