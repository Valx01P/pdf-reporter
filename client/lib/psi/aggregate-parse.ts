// Detect and parse the app's own *aggregate* exports when they're re-uploaded.
// There are two such formats, neither of which is respondent-level data:
//   • tabbook  — wide banner grid (see tabbook-parse.ts), inverse of buildTabbookCsv
//   • toplines — tidy long format "question,type,option,unweighted_pct,rv_pct,…",
//                inverse of buildToplinesCsv (lib/exports.ts)
// Both are read back into a Tabbook so they render in the aggregate viewer and
// re-export cleanly. Every number comes from the file; nothing is invented.

import Papa from "papaparse"
import { summaryRowsFor } from "./tabbook"
import { looksLikeTabbook, parseTabbookCsv } from "./tabbook-parse"
import type { QuestionType, Tabbook, TabbookColumn, TabbookQuestion, TabbookRow } from "../types"

export type AggregateKind = "tabbook" | "toplines"

// Percentage columns we know how to read, in display order, with their labels.
const PCT_COLUMNS: { keys: string[]; label: string }[] = [
  { keys: ["unweighted_pct", "unweighted", "raw_pct"], label: "Unweighted" },
  { keys: ["rv_pct", "rv", "registered_pct"], label: "RV" },
  { keys: ["lv_pct", "lv", "likely_pct"], label: "LV" },
  { keys: ["pct", "percent", "weighted_pct", "result_pct"], label: "Result" },
]

function header(csvText: string): string[] {
  const clean = String(csvText || "").replace(/^﻿/, "").trim()
  const first = clean.split(/\r?\n/, 1)[0] || ""
  return (Papa.parse<string[]>(first, { header: false }).data[0] || []).map((h) => h.trim().toLowerCase())
}

// True when the upload is the tidy long-format toplines export: a `question` and
// `option` column plus at least one recognised percentage column.
export function looksLikeToplines(csvText: string): boolean {
  const h = new Set(header(csvText))
  const hasQ = h.has("question") || h.has("prompt")
  const hasOpt = h.has("option") || h.has("response") || h.has("answer")
  const hasPct = PCT_COLUMNS.some((c) => c.keys.some((k) => h.has(k)))
  return hasQ && hasOpt && hasPct
}

const parsePct = (raw: string): number => {
  const n = Number(String(raw ?? "").trim().replace(/%$/, "").replace(/,/g, ""))
  return Number.isFinite(n) ? n : 0
}

function asType(raw: string): QuestionType {
  const t = String(raw ?? "").trim().toLowerCase()
  if (t === "scale" || t === "binary" || t === "categorical" || t === "nps" || t === "numeric" || t === "open_ended") {
    return t as QuestionType
  }
  return "categorical"
}

// Parse the tidy toplines CSV into a Tabbook whose columns are the universes
// present in the file (Unweighted / RV / LV), one block per question.
export function parseToplinesCsv(csvText: string, name = "Toplines"): Tabbook {
  const clean = String(csvText || "").replace(/^﻿/, "").trim()
  const res = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  })
  const rows = (res.data || []).filter((r) => (r.question || r.prompt || "").trim() !== "")
  const fields = new Set((res.meta.fields || []).map((f) => f.trim().toLowerCase()))

  // Which percentage series are actually present, in display order.
  const series = PCT_COLUMNS
    .map((c) => ({ label: c.label, key: c.keys.find((k) => fields.has(k)) }))
    .filter((s): s is { label: string; key: string } => !!s.key)

  const columns: TabbookColumn[] = series.map((s) => ({
    group: "Topline %",
    groupKey: "topline",
    label: s.label,
    value: s.label,
    isTotal: true, // suppress the (unweighted n) cell and shade — these are totals
    unweightedN: 0,
  }))
  const groups = [{ label: "Topline %", span: columns.length }]

  const qCol = fields.has("question") ? "question" : "prompt"
  const optCol = fields.has("option") ? "option" : fields.has("response") ? "response" : "answer"

  // Group rows by question, preserving first-seen order.
  const order: string[] = []
  const byQ = new Map<string, { type: string; rows: TabbookRow[] }>()
  for (const r of rows) {
    const q = (r[qCol] || "").trim()
    if (!q) continue
    if (!byQ.has(q)) {
      byQ.set(q, { type: (r.type || "").trim(), rows: [] })
      order.push(q)
    }
    byQ.get(q)!.rows.push({
      label: (r[optCol] || "").trim(),
      pct: series.map((s) => parsePct(r[s.key])),
      significant: series.map(() => false),
    })
  }

  const questions: TabbookQuestion[] = order.map((q) => {
    const { type, rows: qRows } = byQ.get(q)!
    return {
      key: q,
      prompt: q,
      type: asType(type),
      rows: qRows,
      summary: summaryRowsFor(qRows, columns.length),
    }
  })

  return { name, universe: "RV", groups, columns, questions }
}

// Re-serialize a parsed toplines Tabbook back to the tidy long format, so the
// aggregate viewer's download produces a clean, normalized toplines CSV.
export function serializeToplinesCsv(tb: Tabbook): string {
  const cols = tb.columns.map((c) => c.label)
  const head = ["question", "type", "option", ...cols.map((c) => c.toLowerCase().replace(/\s+/g, "_") + "_pct")]
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const lines = [head.join(",")]
  for (const q of tb.questions) {
    for (const r of q.rows) {
      lines.push([q.prompt, q.type, r.label, ...r.pct.map((p) => p.toFixed(1))].map(esc).join(","))
    }
  }
  return lines.join("\n")
}

// ── unified dispatcher ───────────────────────────────────────────────────────

export function looksLikeAggregate(csvText: string): boolean {
  return looksLikeTabbook(csvText) || looksLikeToplines(csvText)
}

// Detect which aggregate format (if any) an upload is and parse it to a Tabbook.
// Returns null for respondent-level data, which goes through the normal pipeline.
export function detectAggregate(csvText: string, name = "Tabbook"): { kind: AggregateKind; tabbook: Tabbook } | null {
  if (looksLikeTabbook(csvText)) return { kind: "tabbook", tabbook: parseTabbookCsv(csvText, name) }
  if (looksLikeToplines(csvText)) return { kind: "toplines", tabbook: parseToplinesCsv(csvText, name) }
  return null
}
