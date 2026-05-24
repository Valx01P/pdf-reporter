// Server-only export builders for the dual-universe results. CSV is a plain
// string; XLSX uses exceljs (kept out of the bundle via serverExternalPackages).

import ExcelJS from "exceljs"
import type { Crosstab } from "./types"
import type { ClientPayload, FullResult } from "./psi/service"

function esc(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Tidy toplines CSV: one row per (question, option) with RV / LV / unweighted %.
export function buildToplinesCsv(p: ClientPayload): string {
  const lines = ["question,type,option,unweighted_pct,rv_pct,lv_pct,rv_weighted_n"]
  for (const t of p.toplines) {
    if (t.type === "open_ended" || t.type === "numeric") {
      lines.push([t.prompt, t.type, "", "", "", "", ""].map(esc).join(","))
      continue
    }
    const lvByLabel = new Map(t.lv.options.map((o) => [o.label, o.pct]))
    const uByLabel = new Map(t.unweighted.options.map((o) => [o.label, o.pct]))
    for (const o of t.rv.options) {
      lines.push(
        [t.prompt, t.type, o.label, (uByLabel.get(o.label) ?? 0).toFixed(1), o.pct.toFixed(1), (lvByLabel.get(o.label) ?? 0).toFixed(1), o.weighted.toFixed(1)]
          .map(esc)
          .join(","),
      )
    }
  }
  return lines.join("\n")
}

// Respondent-level CSV: original columns + weight_rv, weight_lv, p_vote.
export function buildRespondentCsv(full: FullResult): string {
  const { parsed, result } = full
  const headers = [...parsed.headers, "weight_rv", "weight_lv", "p_vote", "history_bucket"]
  const lines = [headers.map(esc).join(",")]
  result.derived.forEach((d, k) => {
    const row = parsed.rows[d.i]
    const cells = parsed.headers.map((h) => esc(row[h] ?? ""))
    cells.push(result.rv.weights[k].toFixed(4), result.lvUniverse.weights[k].toFixed(4), result.lv.pvote[k].toFixed(4), d.historyBucket)
    lines.push(cells.join(","))
  })
  return lines.join("\n")
}

export async function buildWorkbook(p: ClientPayload, crosstabs: Crosstab[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "Toplines · PSI Pathway 3"
  wb.created = new Date()

  const summary = wb.addWorksheet("Summary")
  summary.columns = [{ width: 26 }, { width: 24 }, { width: 24 }]
  summary.addRow(["Metric", "Registered Voters", "Likely Voters"]).font = { bold: true }
  const sRows: [string, string | number, string | number][] = [
    ["Study", p.name, ""],
    ["Kept sample", p.quality.kept, p.quality.kept],
    ["Screened out", p.quality.removed, p.quality.removed],
    ["Effective n", p.rv.diagnostics.effectiveN, p.lvUniverse.diagnostics.effectiveN],
    ["DEFF", p.rv.diagnostics.deff, p.lvUniverse.diagnostics.deff],
    ["Margin of error", `±${p.rv.diagnostics.moe}%`, `±${p.lvUniverse.diagnostics.moe}%`],
    ["Mean P(vote)", "", p.lv.model.meanPvote.toFixed(3)],
    ["Weighting set", p.weightingSet, p.weightingSet],
  ]
  sRows.forEach((r) => (summary.addRow(r).getCell(1).font = { bold: true }))

  for (const universe of ["rv", "lv"] as const) {
    const label = universe === "rv" ? "RV Toplines" : "LV Toplines"
    const ws = wb.addWorksheet(label)
    ws.columns = [
      { header: "Question", key: "q", width: 50 },
      { header: "Type", key: "t", width: 14 },
      { header: "Option", key: "o", width: 34 },
      { header: "%", key: "p", width: 9 },
      { header: "Weighted n", key: "w", width: 12 },
    ]
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: "frozen", ySplit: 1 }]
    for (const t of p.toplines) {
      const q = t[universe]
      if (t.type === "open_ended" || t.type === "numeric") {
        ws.addRow({ q: t.prompt, t: t.type, o: t.type === "numeric" && q.numeric ? `mean ${q.numeric.mean}` : `${q.openCount || 0} responses` })
        continue
      }
      q.options.forEach((o, i) => ws.addRow({ q: i === 0 ? t.prompt : "", t: i === 0 ? t.type : "", o: o.label, p: Number(o.pct.toFixed(1)), w: Number(o.weighted.toFixed(1)) }))
    }
  }

  if (crosstabs.length) {
    const sheet = wb.addWorksheet("Crosstabs (RV)")
    for (const ct of crosstabs) {
      sheet.addRow([ct.questionPrompt]).font = { bold: true }
      sheet.addRow([`× ${ct.dimLabel}`])
      const header = ["Option", ...ct.columns.map((c, i) => `${c} (n=${Math.round(ct.columnTotals[i] || 0)})`), "All"]
      sheet.addRow(header).font = { bold: true }
      for (const row of ct.rows) {
        const r = sheet.addRow([row.label, ...row.cells.map((c) => `${c.pct.toFixed(0)}%`), `${row.all.pct.toFixed(0)}%`])
        row.cells.forEach((c, i) => {
          if (c.significant) r.getCell(i + 2).font = { bold: true }
        })
      }
      sheet.addRow([])
    }
    sheet.getColumn(1).width = 36
    for (let i = 2; i <= 13; i++) sheet.getColumn(i).width = 13
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
