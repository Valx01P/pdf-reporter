// Server-only export builders for the dual-universe results. CSV is a plain
// string; XLSX uses exceljs (kept out of the bundle via serverExternalPackages).

import ExcelJS from "exceljs"
import type { Crosstab, Tabbook } from "./types"
import type { BalanceRow, ClientPayload, FullResult } from "./psi/service"
import { bannerGroupLabel } from "./psi/tabbook"
import { formatSummaryValue } from "./tabbook-format"

function esc(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const pct1 = (x: number) => `${x.toFixed(1)}%`

// ── Tabbook CSV (one universe) ──────────────────────────────────────────────
// Matches the PSI reference layout: a survey-name banner, then per question a
// title row, a grouped banner-header row, a column-header row, an (unweighted n)
// row, and one row per response option, with three blank rows between questions.
export function buildTabbookCsv(tb: Tabbook): string {
  const ncol = tb.columns.length + 1 // +1 for the leading Response/label column
  const blank = new Array(ncol).fill("").join(",")
  const lines: string[] = []
  lines.push(["Survey name:"].concat(new Array(ncol - 1).fill("")).map(esc).join(","))
  lines.push([tb.name].concat(new Array(ncol - 1).fill("")).map(esc).join(","))
  lines.push(blank)

  // grouped header row: leading blank, then each group label + (span-1) blanks
  const groupRow = ["", ...tb.groups.flatMap((g) => [g.label, ...new Array(g.span - 1).fill("")])]
  const colHeaderRow = ["Response", ...tb.columns.map((c) => c.label)]
  const nRow = ["(unweighted n)", ...tb.columns.map((c) => (c.isTotal ? "" : String(c.unweightedN)))]

  for (const q of tb.questions) {
    lines.push([q.prompt].concat(new Array(ncol - 1).fill("")).map(esc).join(","))
    lines.push(groupRow.map(esc).join(","))
    lines.push(colHeaderRow.map(esc).join(","))
    lines.push(nRow.map(esc).join(","))
    if (q.rows.length === 0) {
      lines.push([q.note || "—"].concat(new Array(ncol - 1).fill("")).map(esc).join(","))
    } else {
      for (const r of q.rows) {
        lines.push([r.label, ...r.pct.map((p) => (q.valueFormat === "rank" ? p.toFixed(2) : pct1(p)))].map(esc).join(","))
      }
    }
    if (q.summary) for (const s of q.summary) lines.push([s.label, ...s.values.map((v) => formatSummaryValue(v, s.format))].map(esc).join(","))
    lines.push(blank, blank, blank)
  }
  return lines.join("\n")
}

// ── Weight Diagnostics CSV ──────────────────────────────────────────────────
export function buildDiagnosticsCsv(p: ClientPayload, rvBalance: BalanceRow[], lvBalance: BalanceRow[]): string {
  const rv = p.rv.diagnostics
  const lv = p.lvUniverse.diagnostics
  const lines: string[] = []
  const row = (cells: (string | number)[]) => lines.push(cells.map(esc).join(","))

  row(["Weighting Diagnostics — Summary Statistics", "", "", ""])
  row(["Statistic", "RV Value", "LV Value", "Notes"])
  row(["DEFF", rv.deff, lv.deff, "Design effect: 1.0=ideal, >2.0=concerning"])
  row(["Kish_DEFF", rv.kishDeff, lv.kishDeff, "Kish 1+CV^2(w) approximation"])
  row(["effective_N", rv.effectiveN, lv.effectiveN, "n / DEFF — real statistical power"])
  row(["n_unweighted", rv.n, lv.n, "Raw respondents used"])
  row(["margin_of_error", `±${rv.moe}%`, `±${lv.moe}%`, "95% CI at p=0.5, DEFF-adjusted"])
  row(["weight_min", rv.weightMin, lv.weightMin, "Smallest individual weight"])
  row(["weight_mean", rv.weightMean, lv.weightMean, "Normalised to 1"])
  row(["weight_median", rv.weightMedian ?? "—", lv.weightMedian ?? "—", "Median weight"])
  row(["weight_max", rv.weightMax, lv.weightMax, "Largest individual weight"])
  row(["weight_p99", rv.weightP99 ?? "—", lv.weightP99 ?? "—", "99th-percentile weight (trim cap)"])
  row(["pct_weight_gt2", rv.pctGt2 ?? "—", lv.pctGt2 ?? "—", "% of weights above 2x the mean"])
  row(["pct_weight_gt3", rv.pctGt3 ?? "—", lv.pctGt3 ?? "—", "% of weights above 3x the mean"])
  row([])
  row([])

  for (const [label, balance] of [["── RV ──", rvBalance], ["── LV ──", lvBalance]] as const) {
    row(["Covariate Balance After Weighting (SMD < 0.10 = balanced)", "", "", "", "", "", ""])
    row([label, "", "", "", "", "", ""])
    row(["Variable", "Category", "Target %", "Weighted %", "Diff (pp)", "SMD", "Balanced?"])
    for (const b of balance) {
      row([b.variable, b.category, b.target.toFixed(2), b.weighted.toFixed(2), b.diff.toFixed(2), b.smd.toFixed(3), b.balanced ? "balanced" : "review"])
    }
    row([])
    row([])
  }

  row(["Margin of Error by Question (DEFF-adjusted, 95% CI)", "", "", ""])
  row(["Question", "Response", "Weighted % (RV)", "MoE (±pp)"])
  for (const t of p.toplines) {
    if (t.type === "numeric" || t.type === "open_ended") continue
    for (const o of t.rv.options) row([t.prompt, o.label, o.pct.toFixed(1), t.rv.moe])
  }
  return lines.join("\n")
}

// ── Electorate Composition CSV ──────────────────────────────────────────────
// RV then LV weighted composition per demographic banner. Weighted_N is derived
// from the share × kept sample (weights are normalised to mean 1).
export function buildCompositionCsv(p: ClientPayload): string {
  const kept = p.quality.kept
  const lines: string[] = []
  const row = (cells: (string | number)[]) => lines.push(cells.map(esc).join(","))
  for (const [title, pick] of [
    ["Registered Voters Electorate (weighted)", (v: { rv: number; lv: number }) => v.rv],
    ["Likely Voters Electorate (derived; weighted)", (v: { rv: number; lv: number }) => v.lv],
  ] as const) {
    row([title, "", "", ""])
    row(["Variable", "Category", "Weighted_N", "Weighted_%"])
    for (const d of p.composition) {
      d.values.forEach((v, i) => {
        const share = pick(v)
        row([i === 0 ? bannerGroupLabel(d.key) : "", v.value, ((share / 100) * kept).toFixed(1), `${share.toFixed(1)}%`])
      })
    }
    row([])
    row([])
  }
  return lines.join("\n")
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

export interface WorkbookExtras {
  tabbookRv?: Tabbook
  tabbookLv?: Tabbook
  balanceRv?: BalanceRow[]
  balanceLv?: BalanceRow[]
}

// One Tabbook worksheet: grouped banner header (merged), column header, the
// (unweighted n) row, then a block per question.
function addTabbookSheet(wb: ExcelJS.Workbook, label: string, tb: Tabbook) {
  const ws = wb.addWorksheet(label)
  ws.getColumn(1).width = 40
  for (let i = 2; i <= tb.columns.length + 1; i++) ws.getColumn(i).width = 11

  const groupRow = ws.addRow(["", ...tb.groups.flatMap((g) => [g.label, ...new Array(g.span - 1).fill("")])])
  groupRow.font = { bold: true }
  // merge each group label across its span
  let col = 2 // column 1 is the Response label column
  for (const g of tb.groups) {
    if (g.span > 1) ws.mergeCells(groupRow.number, col, groupRow.number, col + g.span - 1)
    const cell = ws.getCell(groupRow.number, col)
    cell.alignment = { horizontal: "center" }
    col += g.span
  }
  ws.addRow(["Response", ...tb.columns.map((c) => c.label)]).font = { bold: true }
  ws.addRow(["(unweighted n)", ...tb.columns.map((c) => (c.isTotal ? "" : c.unweightedN))])
  ws.addRow([])

  for (const q of tb.questions) {
    ws.addRow([q.prompt]).font = { bold: true }
    if (q.rows.length === 0) {
      ws.addRow([q.note || "—"])
    } else {
      for (const r of q.rows) {
        const xr = ws.addRow([r.label, ...r.pct.map((v) => Number(v.toFixed(q.valueFormat === "rank" ? 2 : 1)))])
        r.significant.forEach((sig, i) => {
          if (sig) xr.getCell(i + 2).font = { bold: true }
        })
      }
    }
    if (q.summary) {
      for (const s of q.summary) {
        // Keep pct/net as numeric cells (consistent with the option rows above);
        // only the horse-race margin ("D+8.4") is inherently a label.
        const cells = s.values.map((v) => (s.format === "margin" ? formatSummaryValue(v, s.format) : Number(v.toFixed(1))))
        const sr = ws.addRow([s.label, ...cells])
        if (s.emphasis) sr.font = { bold: true }
      }
    }
    ws.addRow([])
  }
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }]
}

export async function buildWorkbook(p: ClientPayload, crosstabs: Crosstab[], extras: WorkbookExtras = {}): Promise<Buffer> {
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

  // Tabbooks: every question's Total + all banner groups in one wide grid.
  if (extras.tabbookRv) addTabbookSheet(wb, "RV Tabbook", extras.tabbookRv)
  if (extras.tabbookLv) addTabbookSheet(wb, "LV Tabbook", extras.tabbookLv)

  // Electorate composition (RV + LV) per demographic banner.
  {
    const ws = wb.addWorksheet("Electorate")
    ws.columns = [{ width: 26 }, { width: 30 }, { width: 14 }, { width: 12 }]
    const kept = p.quality.kept
    for (const [title, pick] of [
      ["Registered Voters Electorate (weighted)", (v: { rv: number; lv: number }) => v.rv],
      ["Likely Voters Electorate (derived; weighted)", (v: { rv: number; lv: number }) => v.lv],
    ] as const) {
      ws.addRow([title]).font = { bold: true }
      ws.addRow(["Variable", "Category", "Weighted N", "Weighted %"]).font = { bold: true }
      for (const d of p.composition) {
        d.values.forEach((v, i) => {
          const share = pick(v)
          ws.addRow([i === 0 ? bannerGroupLabel(d.key) : "", v.value, Number(((share / 100) * kept).toFixed(1)), `${share.toFixed(1)}%`])
        })
      }
      ws.addRow([])
    }
  }

  // Weighting diagnostics: summary stats + covariate balance per universe.
  {
    const ws = wb.addWorksheet("Diagnostics")
    ws.columns = [{ width: 22 }, { width: 30 }, { width: 12 }, { width: 12 }, { width: 11 }, { width: 9 }, { width: 11 }]
    const rv = p.rv.diagnostics
    const lv = p.lvUniverse.diagnostics
    ws.addRow(["Summary Statistics", "RV", "LV"]).font = { bold: true }
    const stat: [string, string | number, string | number][] = [
      ["DEFF", rv.deff, lv.deff],
      ["Kish DEFF", rv.kishDeff, lv.kishDeff],
      ["Effective N", rv.effectiveN, lv.effectiveN],
      ["n (unweighted)", rv.n, lv.n],
      ["Margin of error", `±${rv.moe}%`, `±${lv.moe}%`],
      ["Weight min", rv.weightMin, lv.weightMin],
      ["Weight max", rv.weightMax, lv.weightMax],
    ]
    stat.forEach((r) => (ws.addRow(r).getCell(1).font = { bold: true }))
    ws.addRow([])
    for (const [label, balance] of [["Covariate balance — RV", extras.balanceRv], ["Covariate balance — LV", extras.balanceLv]] as const) {
      if (!balance) continue
      ws.addRow([label]).font = { bold: true }
      ws.addRow(["Variable", "Category", "Target %", "Weighted %", "Diff (pp)", "SMD", "Balanced?"]).font = { bold: true }
      for (const b of balance) {
        ws.addRow([b.variable, b.category, Number(b.target.toFixed(2)), Number(b.weighted.toFixed(2)), Number(b.diff.toFixed(2)), Number(b.smd.toFixed(3)), b.balanced ? "balanced" : "review"])
      }
      ws.addRow([])
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
