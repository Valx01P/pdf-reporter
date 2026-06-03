// Server-only. Renders the Pathway 3 dual-universe report as a polished,
// explanatory document (navy header band, blue section eyebrows + intro prose,
// lavender callout boxes, navy-header tables) — modelled on the PSI reference.
// Every section narrates what the methodology did and how to read it, not just
// the numbers. Returns a Buffer.

import PDFDocument from "pdfkit"
import type { AiSummary, Crosstab, Question, Tabbook, TabbookColumn, TabbookQuestion } from "./types"
import type { ClientPayload } from "./psi/service"
import type { UncertaintyResult } from "./psi/uncertainty"
import { isNeutralLabel } from "./scales"
import { formatSummaryValue } from "./tabbook-format"

const PAGE_W = 612
const PAGE_H = 792
const M = 54
const CONTENT_W = PAGE_W - M * 2
const BOTTOM = PAGE_H - 70 // content stops here; footer sits below
const MAX_REPORT_BARS = 14 // renderer backstop: never chart more options than fit a page

const NAVY = "#0f1e3d"
const PRIMARY = "#4f46e5"
const INK = "#111827"
const BODY = "#374151"
const MUTED = "#6b7280"
const FAINT = "#9ca3af"
const LINE = "#e2e8f0"
const CALLOUT_BG = "#eef2ff"
const CALLOUT_BORDER = "#c7d2fe"
const ROW_ALT = "#f8fafc"
const POS = PRIMARY
const NEG = "#94a3b8"

type Doc = PDFKit.PDFDocument

export interface ReportInput {
  payload: ClientPayload
  summary?: AiSummary | null
  crosstabs?: Crosstab[]
  uncertainty?: UncertaintyResult | null
  meta?: { client?: string; pollster?: string; fieldStart?: string; fieldEnd?: string }
}

export function buildReportPdf({ payload, summary, crosstabs = [], uncertainty = null, meta = {} }: ReportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: { Title: `${payload.name} — Pathway 3`, Author: meta.pollster || "Public Sentiment Institute" },
    })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const r = new Renderer(doc)

    // ── Cover ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 132).fill(NAVY)
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff").text("PUBLIC SENTIMENT INSTITUTE", M, 40, { characterSpacing: 1.2 })
    doc.font("Helvetica").fontSize(9).fillColor("#aab4cf").text("Pathway 3 — Dual-Universe Report", M, 58)
    doc.font("Helvetica").fontSize(8).fillColor("#aab4cf").text(`Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, M, 40, { width: CONTENT_W, align: "right" })

    r.y = 168
    doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(payload.name, M, r.y, { width: CONTENT_W })
    r.y += doc.heightOfString(payload.name, { width: CONTENT_W }) + 8
    const subline = [
      meta.client ? `Prepared for ${meta.client}` : null,
      meta.pollster ? `by ${meta.pollster}` : null,
      meta.fieldStart || meta.fieldEnd ? `Field ${[meta.fieldStart, meta.fieldEnd].filter(Boolean).join(" – ")}` : null,
    ].filter(Boolean).join("   ·   ")
    if (subline) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(subline, M, r.y, { width: CONTENT_W })
      r.y += 18
    }
    r.y += 8

    // Key facts table
    r.facts(payload)
    r.y += 6
    r.callout(
      "What this report contains. Results are reported for two independent voter universes — Registered Voters (everyone who could vote) and Likely Voters (weighted by each respondent's modelled turnout probability). Where they differ, the Likely-Voter figure is the better guide to the actual midterm electorate. Each section below explains what the step did and how to read it.",
    )

    // ── Executive summary ────────────────────────────────────────────────────
    if (summary && (summary.overview || summary.findings?.length)) {
      r.section("Summary", "Executive summary")
      if (summary.headline) {
        r.need(40)
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(ascii(summary.headline), M, r.y, { width: CONTENT_W })
        r.y += doc.heightOfString(ascii(summary.headline), { width: CONTENT_W }) + 8
      }
      if (summary.overview) r.prose(ascii(summary.overview))
      for (const f of summary.findings || []) r.bullet(ascii(f))
      if (summary.methodologyNote) {
        r.y += 4
        doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED).text(ascii(summary.methodologyNote), M, r.y, { width: CONTENT_W })
        r.y += doc.heightOfString(ascii(summary.methodologyNote), { width: CONTENT_W }) + 6
      }
    }

    // ── Likely-voter model ────────────────────────────────────────────────────
    r.section("Likely voters", "Who counts as a likely voter")
    r.prose(
      `Every respondent is scored on a turnout-propensity model built from three questions — how motivated they are to vote, how far they've gotten in actually preparing to vote, and whether the people around them vote. Those combine into a probability of voting, P(vote), which here averages ${(payload.lv.model.meanPvote * 100).toFixed(0)}% and is calibrated to a projected turnout of ${(payload.lv.projectedTurnout * 100).toFixed(0)}%. High-propensity respondents carry more weight in the Likely-Voter universe; low-propensity respondents carry less.`,
    )
    r.kvTable([
      ["Mean P(vote)", payload.lv.model.meanPvote.toFixed(3)],
      ["Near-certain voters (P 0.9+)", payload.lv.model.highCount.toLocaleString()],
      ["Near-certain non-voters (P 0.1 or less)", payload.lv.model.lowCount.toLocaleString()],
      ["Consistent / occasional / new voters", `${payload.lv.model.buckets.consistent.toLocaleString()} / ${payload.lv.model.buckets.occasional.toLocaleString()} / ${payload.lv.model.buckets.new.toLocaleString()}`],
    ])

    // ── Toplines ──────────────────────────────────────────────────────────────
    r.section("Results", "Toplines — Registered vs Likely Voters")
    r.prose("Each question is shown for both universes side by side. The italic line reads the result for you and flags where the likely-voter screen moves the number.")
    payload.toplines.forEach((t, i) => r.dualQuestion(t.prompt, i, t.rv, t.lv))

    // ── Shift ──────────────────────────────────────────────────────────────────
    const recall = payload.shift.find((s) => s.dimension === "recall2024")
    if (recall) {
      r.section("The screen at work", "How the likely-voter screen reshapes the electorate")
      r.prose("This traces the 2024-vote makeup of the sample across the screen: the registered-voter mix, then after applying P(vote), then the final likely-voter mix. The compression of non-voters (DNV) is the whole point of a likely-voter model.")
      r.shiftTable(recall.rows)
      r.prose(shiftInsight(recall.rows), true)
    }

    // ── Uncertainty ──────────────────────────────────────────────────────────
    if (uncertainty && uncertainty.questions.length) {
      r.section("Uncertainty", "How much to trust these numbers")
      r.prose(
        `Two kinds of uncertainty are quantified. The bootstrap standard error (± below) captures sampling noise — how much a number would wobble if you re-drew the sample. The Monte Carlo range re-runs the whole likely-voter pipeline across ${uncertainty.scenarios.length} scenarios (three turnout levels × three target sets); its width is the honest envelope around each likely-voter estimate, here about ±${uncertainty.envelopePp} points on the headline numbers.`,
      )
      r.uncertaintyBlocks(uncertainty)
    }

    // ── Diagnostics ─────────────────────────────────────────────────────────
    r.section("Diagnostics", "Quality checks")
    r.prose("Weighting trades a little statistical power for representativeness. The design effect (DEFF) measures that cost; the effective sample size is the sample's real power after weighting, and drives the margin of error. Covariate balance confirms the weighted sample matches its demographic targets.")
    r.diagnosticsTable(payload)

    // ── Crosstabs ─────────────────────────────────────────────────────────────
    if (crosstabs.length) {
      r.section("Crosstabs", "Who answered how (Registered Voters)")
      r.prose("Column percentages within each subgroup. Figures in brand color diverge from the row's overall result beyond the 95% confidence interval — i.e. that subgroup is meaningfully different, not noise.")
      for (const ct of crosstabs) r.crosstab(ct)
    }

    // ── Methodology disclosure ─────────────────────────────────────────────────
    r.section("Methodology", "Full methodology disclosure")
    for (const p of methodologyParts(payload)) r.prose(p)

    // ── Footer on every page (margins.bottom neutralised so it never paginates) ─
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.page.margins.bottom = 0
      doc.moveTo(M, PAGE_H - 48).lineTo(PAGE_W - M, PAGE_H - 48).strokeColor(LINE).lineWidth(0.5).stroke()
      doc.font("Helvetica").fontSize(7.5).fillColor(FAINT)
      doc.text(`${ascii(payload.name)} · Public Sentiment Institute`, M, PAGE_H - 40, { lineBreak: false })
      doc.text(`Pathway 3 · n=${payload.quality.kept.toLocaleString()} · page ${i - range.start + 1} of ${range.count}`, M, PAGE_H - 40, { width: CONTENT_W, align: "right", lineBreak: false })
    }

    doc.end()
  })
}

// ── Aggregate (already-processed) tabbook / toplines → PDF ────────────────────
// Renders an already-processed export straight to PDF — the grid the user
// uploaded, not a rebuilt methodology report (there are no respondents to model).
// Every number is read from the parsed Tabbook. Wide tabbooks are split across
// column "panels" so banners that don't fit the page width still print.

export interface TabbookPdfInput {
  tabbook: Tabbook
  kind?: "tabbook" | "toplines"
  meta?: { client?: string; pollster?: string; fieldStart?: string; fieldEnd?: string }
}

export function buildTabbookPdf({ tabbook, kind = "tabbook", meta = {} }: TabbookPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const isToplines = kind === "toplines"
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: M, bottom: M, left: M, right: M },
      bufferPages: true,
      info: { Title: `${tabbook.name} — ${isToplines ? "Toplines" : "Tabbook"}`, Author: meta.pollster || "Public Sentiment Institute" },
    })
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    const r = new Renderer(doc)
    const colCount = Math.max(0, tabbook.columns.length - 1)

    // ── Cover ──────────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 132).fill(NAVY)
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff").text("PUBLIC SENTIMENT INSTITUTE", M, 40, { characterSpacing: 1.2 })
    doc.font("Helvetica").fontSize(9).fillColor("#aab4cf").text(isToplines ? "Toplines Export" : `Tabbook Export — ${tabbook.universe}`, M, 58)
    doc.font("Helvetica").fontSize(8).fillColor("#aab4cf").text(`Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, M, 40, { width: CONTENT_W, align: "right" })

    r.y = 168
    doc.font("Helvetica-Bold").fontSize(22).fillColor(INK).text(ascii(tabbook.name), M, r.y, { width: CONTENT_W })
    r.y += doc.heightOfString(ascii(tabbook.name), { width: CONTENT_W }) + 8
    const subline = [
      meta.client ? `Prepared for ${meta.client}` : null,
      meta.pollster ? `by ${meta.pollster}` : null,
      meta.fieldStart || meta.fieldEnd ? `Field ${[meta.fieldStart, meta.fieldEnd].filter(Boolean).join(" – ")}` : null,
    ].filter(Boolean).join("   ·   ")
    if (subline) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(ascii(subline), M, r.y, { width: CONTENT_W })
      r.y += 18
    }
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(
      isToplines
        ? `${tabbook.questions.length} questions · ${tabbook.columns.map((c) => ascii(c.label)).join(" / ")}`
        : `${tabbook.universe} universe · ${tabbook.questions.length} questions · ${colCount} banner column${colCount === 1 ? "" : "s"}`,
      M, r.y, { width: CONTENT_W },
    )
    r.y += 22

    r.callout(
      isToplines
        ? "This file is an already-processed toplines export — final results, not respondent-level data. Every percentage below is read directly from your file. The Pathway 3 weighting and turnout model can't be rebuilt from an aggregate file, so it isn't applied here."
        : "This file is an already-processed tabbook — aggregate crosstab output, not respondent-level data. Every percentage is read directly from your file, and the significance flags are re-derived from those numbers and each column's unweighted n. The Pathway 3 weighting and turnout model can't be rebuilt from an aggregate file, so it isn't applied here. Cells in brand color diverge from the Total beyond the 95% confidence interval.",
    )

    r.section("Results", isToplines ? "Toplines" : `Tabbook — ${tabbook.universe}`)
    tabbook.questions.forEach((q, qi) => tabbookQuestion(r, q, qi, tabbook.columns, kind))

    // ── Footer on every page ───────────────────────────────────────────────
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.page.margins.bottom = 0
      doc.moveTo(M, PAGE_H - 48).lineTo(PAGE_W - M, PAGE_H - 48).strokeColor(LINE).lineWidth(0.5).stroke()
      doc.font("Helvetica").fontSize(7.5).fillColor(FAINT)
      doc.text(`${ascii(tabbook.name)} · Public Sentiment Institute`, M, PAGE_H - 40, { lineBreak: false })
      doc.text(`${isToplines ? "Toplines" : tabbook.universe + " Tabbook"} · page ${i - range.start + 1} of ${range.count}`, M, PAGE_H - 40, { width: CONTENT_W, align: "right", lineBreak: false })
    }

    doc.end()
  })
}

// One question block: heading, then the option rows × columns as a grid. Wide
// column sets are split into successive panels, each led by the Total column.
function tabbookQuestion(r: Renderer, q: TabbookQuestion, qi: number, cols: TabbookColumn[], kind: "tabbook" | "toplines") {
  const doc = r.doc
  const heading = `Q${qi + 1}. ${ascii(q.prompt)}`
  const headH = doc.font("Helvetica-Bold").fontSize(11).heightOfString(heading, { width: CONTENT_W, lineGap: 1 })
  r.need(headH + 44)
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(heading, M, r.y, { width: CONTENT_W, lineGap: 1 })
  r.y += headH + 6

  // Numeric / open-ended carry no option rows — just the one-line note.
  if (!q.rows.length) {
    const note = q.note ? ascii(q.note) : "No tabulated options."
    const h = doc.font("Helvetica").fontSize(9).heightOfString(note, { width: CONTENT_W })
    r.need(h + 6)
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(note, M, r.y, { width: CONTENT_W })
    r.y += h + 12
    return
  }

  const labelW = 152
  const avail = CONTENT_W - labelW
  const perPanel = Math.max(1, Math.floor(avail / 46)) // 46pt min keeps "D+12.3" / "100.0%" readable

  // Split column indices into panels. A tabbook leads every panel with Total
  // (index 0) for reference; toplines columns are all peers, so just chunk them.
  const panels: number[][] = []
  if (kind === "toplines") {
    for (let i = 0; i < cols.length; i += perPanel) panels.push(rangeIdx(i, Math.min(cols.length, i + perPanel)))
  } else {
    const banners = cols.map((_, i) => i).slice(1)
    if (!banners.length) panels.push([0])
    else for (let i = 0; i < banners.length; i += perPanel - 1) panels.push([0, ...banners.slice(i, i + perPanel - 1)])
  }

  panels.forEach((idxs, pi) => drawTabPanel(r, q, cols, idxs, labelW, avail / idxs.length, panels.length > 1 ? pi + 1 : 0, panels.length))
  r.y += 8
}

function drawTabPanel(
  r: Renderer,
  q: TabbookQuestion,
  cols: TabbookColumn[],
  idxs: number[],
  labelW: number,
  colW: number,
  panelNo: number,
  panelCount: number,
) {
  const doc = r.doc
  const HEADER_H = 34
  const ROW_H = 15

  if (panelNo) {
    const groups = Array.from(new Set(idxs.map((i) => cols[i].group))).map(ascii).join(" · ")
    r.need(11 + HEADER_H + ROW_H)
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED).text(`Columns ${panelNo} of ${panelCount}: ${groups}`, M, r.y)
    r.y += 11
  }

  const drawHeader = () => {
    doc.rect(M, r.y, CONTENT_W, HEADER_H).fill(NAVY)
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff").text("Response", M + 8, r.y + 13, { width: labelW - 12 })
    idxs.forEach((ci, k) => {
      const x = M + labelW + k * colW
      const c = cols[ci]
      // Two lines max for the banner label, ellipsized — keeps the n= line clear.
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff").text(ascii(c.label), x, r.y + 3, { width: colW - 4, height: 18, ellipsis: true, align: "right" })
      if (!c.isTotal) doc.font("Helvetica").fontSize(6).fillColor("#aab4cf").text(`n=${c.unweightedN}`, x, r.y + 24, { width: colW - 4, align: "right", lineBreak: false })
    })
    r.y += HEADER_H
  }

  let startY = r.y
  let startBreaks = r.breaks
  r.need(HEADER_H + ROW_H)
  startY = r.y
  startBreaks = r.breaks
  drawHeader()

  const drawRow = (label: string, emphasis: boolean, alt: boolean, cell: (ci: number) => string, sig: (ci: number) => boolean) => {
    if (r.y + ROW_H > BOTTOM) {
      frameTabPanel(r, startY, labelW, startBreaks)
      r.addPage()
      startY = r.y
      startBreaks = r.breaks
      drawHeader()
    }
    if (alt) doc.rect(M, r.y, CONTENT_W, ROW_H).fill(ROW_ALT)
    // Clamp to one line + ellipsis so a long option never spills into the next row.
    doc.font(emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(emphasis ? INK : BODY).text(ascii(label), M + 8, r.y + 4, { width: labelW - 12, height: 10, ellipsis: true, lineBreak: false })
    idxs.forEach((ci, k) => {
      const x = M + labelW + k * colW
      const isTot = cols[ci].isTotal
      if (sig(ci)) doc.font("Helvetica-Bold").fillColor(PRIMARY)
      else doc.font(isTot || emphasis ? "Helvetica-Bold" : "Helvetica").fillColor(isTot || emphasis ? INK : "#4b5563")
      doc.fontSize(7.5).text(cell(ci), x, r.y + 4, { width: colW - 4, align: "right" })
    })
    doc.moveTo(M, r.y + ROW_H).lineTo(PAGE_W - M, r.y + ROW_H).strokeColor(LINE).lineWidth(0.3).stroke()
    r.y += ROW_H
  }

  q.rows.forEach((row, ri) =>
    drawRow(
      row.label,
      false,
      ri % 2 === 1,
      (ci) => (q.valueFormat === "rank" ? (row.pct[ci] ?? 0).toFixed(2) : `${(row.pct[ci] ?? 0).toFixed(1)}%`),
      (ci) => !cols[ci].isTotal && !!row.significant[ci],
    ),
  )
  for (const s of q.summary || []) {
    drawRow(s.label, !!s.emphasis, false, (ci) => formatSummaryValue(s.values[ci] ?? 0, s.format), () => false)
  }

  frameTabPanel(r, startY, labelW, startBreaks)
  r.y += 10
}

// Outer border + the separator after the label column, for the current segment.
function frameTabPanel(r: Renderer, startY: number, labelW: number, startBreaks: number) {
  if (r.breaks !== startBreaks) return // spilled to a new page; the segment border is skipped
  r.doc.rect(M, startY, CONTENT_W, r.y - startY).strokeColor(LINE).lineWidth(0.8).stroke()
  r.doc.moveTo(M + labelW, startY).lineTo(M + labelW, r.y).strokeColor(LINE).lineWidth(0.4).stroke()
}

function rangeIdx(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i < b; i++) out.push(i)
  return out
}

// ── Renderer: cursor + reusable blocks ────────────────────────────────────────

class Renderer {
  doc: Doc
  y = M
  breaks = 0
  constructor(doc: Doc) {
    this.doc = doc
  }
  addPage() {
    this.doc.addPage()
    this.y = M
    this.breaks++
  }
  need(h: number) {
    if (this.y + h > BOTTOM) this.addPage()
  }
  section(eyebrow: string, title: string) {
    this.need(70)
    if (this.y > M + 4) this.y += 14
    this.doc.font("Helvetica-Bold").fontSize(8).fillColor(PRIMARY).text(eyebrow.toUpperCase(), M, this.y, { characterSpacing: 1 })
    this.y += 13
    this.doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(title, M, this.y, { width: CONTENT_W })
    this.y += this.doc.heightOfString(title, { width: CONTENT_W }) + 4
    this.doc.moveTo(M, this.y).lineTo(PAGE_W - M, this.y).strokeColor(PRIMARY).lineWidth(1.2).stroke()
    this.y += 12
  }
  prose(text: string, muted = false) {
    if (!text) return
    const h = this.doc.font(muted ? "Helvetica-Oblique" : "Helvetica").fontSize(muted ? 9 : 10).heightOfString(text, { width: CONTENT_W, lineGap: 2 })
    this.need(h + 6)
    this.doc.font(muted ? "Helvetica-Oblique" : "Helvetica").fontSize(muted ? 9 : 10).fillColor(muted ? MUTED : BODY).text(text, M, this.y, { width: CONTENT_W, lineGap: 2 })
    this.y += h + 8
  }
  bullet(text: string) {
    const w = CONTENT_W - 14
    const h = this.doc.font("Helvetica").fontSize(10).heightOfString(text, { width: w, lineGap: 1.5 })
    this.need(h + 4)
    this.doc.circle(M + 3, this.y + 5, 1.9).fill(PRIMARY)
    this.doc.font("Helvetica").fontSize(10).fillColor(BODY).text(text, M + 14, this.y, { width: w, lineGap: 1.5 })
    this.y += h + 6
  }
  callout(text: string) {
    const pad = 12
    const w = CONTENT_W - pad * 2
    const h = this.doc.font("Helvetica").fontSize(9).heightOfString(text, { width: w, lineGap: 2 })
    this.need(h + pad * 2 + 6)
    this.doc.roundedRect(M, this.y, CONTENT_W, h + pad * 2, 6).fillAndStroke(CALLOUT_BG, CALLOUT_BORDER)
    this.doc.font("Helvetica").fontSize(9).fillColor("#3730a3").text(text, M + pad, this.y + pad, { width: w, lineGap: 2 })
    this.y += h + pad * 2 + 10
  }
  // simple two-column key/value table
  kvTable(rows: [string, string][]) {
    const rh = 20
    this.need(rows.length * rh + 4)
    const startY = this.y
    rows.forEach(([k, v], i) => {
      if (i % 2 === 0) this.doc.rect(M, this.y, CONTENT_W, rh).fill(ROW_ALT)
      this.doc.font("Helvetica").fontSize(9).fillColor(BODY).text(ascii(k), M + 10, this.y + 6, { width: CONTENT_W - 160 })
      this.doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(ascii(v), M + CONTENT_W - 150, this.y + 6, { width: 140, align: "right" })
      this.y += rh
    })
    this.doc.rect(M, startY, CONTENT_W, this.y - startY).strokeColor(LINE).lineWidth(0.8).stroke()
    this.y += 10
  }
  facts(p: ClientPayload) {
    const cols = [
      { h: "Metric", w: CONTENT_W * 0.46, a: "left" as const },
      { h: "Registered Voters", w: CONTENT_W * 0.27, a: "right" as const },
      { h: "Likely Voters", w: CONTENT_W * 0.27, a: "right" as const },
    ]
    const rows: string[][] = [
      ["Sample kept (of " + p.quality.total.toLocaleString() + ")", p.quality.kept.toLocaleString(), p.quality.kept.toLocaleString()],
      ["Effective sample size", p.rv.diagnostics.effectiveN.toLocaleString(), p.lvUniverse.diagnostics.effectiveN.toLocaleString()],
      ["Margin of error (95%)", `±${p.rv.diagnostics.moe}%`, `±${p.lvUniverse.diagnostics.moe}%`],
      ["Design effect (DEFF)", String(p.rv.diagnostics.deff), String(p.lvUniverse.diagnostics.deff)],
      ["Questions · weighting set", `${p.toplines.length} · Set ${p.weightingSet}`, `${p.toplines.length} · Set ${p.weightingSet}`],
    ]
    this.gridTable(cols, rows)
  }
  diagnosticsTable(p: ClientPayload) {
    const cols = [
      { h: "Check", w: CONTENT_W * 0.4, a: "left" as const },
      { h: "Registered Voters", w: CONTENT_W * 0.3, a: "right" as const },
      { h: "Likely Voters", w: CONTENT_W * 0.3, a: "right" as const },
    ]
    const rows = [
      ["Effective sample size", p.rv.diagnostics.effectiveN.toLocaleString(), p.lvUniverse.diagnostics.effectiveN.toLocaleString()],
      ["Design effect (DEFF)", String(p.rv.diagnostics.deff), String(p.lvUniverse.diagnostics.deff)],
      ["Margin of error (95%)", `±${p.rv.diagnostics.moe}%`, `±${p.lvUniverse.diagnostics.moe}%`],
      ["Weight range", `${p.rv.diagnostics.weightMin}–${p.rv.diagnostics.weightMax}`, `${p.lvUniverse.diagnostics.weightMin}–${p.lvUniverse.diagnostics.weightMax}`],
      ["Covariate balance", p.rv.diagnostics.smd.every((s) => s.balanced) ? "Balanced" : "Review", p.lvUniverse.diagnostics.smd.every((s) => s.balanced) ? "Balanced" : "Review"],
    ]
    this.gridTable(cols, rows)
  }
  // generic navy-header grid table with wrapping cells + alternating rows
  gridTable(cols: { h: string; w: number; a: "left" | "right" }[], rows: string[][]) {
    const drawHeader = () => {
      const hh = 22
      this.doc.rect(M, this.y, CONTENT_W, hh).fill(NAVY)
      let x = M
      cols.forEach((c) => {
        this.doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text(c.h, x + 8, this.y + 7, { width: c.w - 16, align: c.a })
        x += c.w
      })
      this.y += hh
    }
    this.need(22 + 24)
    let startY = this.y
    let startBreaks = this.breaks
    drawHeader()
    rows.forEach((row, ri) => {
      const heights = cols.map((c, ci) => this.doc.font("Helvetica").fontSize(9).heightOfString(ascii(row[ci] ?? ""), { width: c.w - 16 }))
      const rh = Math.max(20, ...heights.map((h) => h + 10))
      if (this.y + rh > BOTTOM) {
        this.frameTable(cols, startY, startBreaks)
        this.addPage()
        startY = this.y
        startBreaks = this.breaks
        drawHeader()
      }
      if (ri % 2 === 1) this.doc.rect(M, this.y, CONTENT_W, rh).fill(ROW_ALT)
      let x = M
      cols.forEach((c, ci) => {
        this.doc.font(ci === 0 ? "Helvetica" : "Helvetica-Bold").fontSize(9).fillColor(ci === 0 ? BODY : INK).text(ascii(row[ci] ?? ""), x + 8, this.y + 6, { width: c.w - 16, align: c.a })
        x += c.w
      })
      this.doc.moveTo(M, this.y + rh).lineTo(PAGE_W - M, this.y + rh).strokeColor(LINE).lineWidth(0.4).stroke()
      this.y += rh
    })
    this.frameTable(cols, startY, startBreaks)
    this.y += 12
  }
  // outer border + column separators for the current table segment
  frameTable(cols: { h: string; w: number; a: "left" | "right" }[], startY: number, startBreaks: number) {
    if (this.breaks !== startBreaks) return // segment spilled to a new page; skip
    this.doc.rect(M, startY, CONTENT_W, this.y - startY).strokeColor(LINE).lineWidth(0.8).stroke()
    let x = M
    for (let c = 0; c < cols.length - 1; c++) {
      x += cols[c].w
      this.doc.moveTo(x, startY + 22).lineTo(x, this.y).strokeColor(LINE).lineWidth(0.4).stroke()
    }
  }
  dualQuestion(prompt: string, i: number, rv: Question, lv: Question) {
    const heading = `Q${i + 1}. ${ascii(prompt)}`
    const headH = this.doc.font("Helvetica-Bold").fontSize(11).heightOfString(heading, { width: CONTENT_W, lineGap: 1 })
    if (rv.type !== "open_ended" && rv.type !== "numeric") {
      const colW = (CONTENT_W - 22) / 2
      const blockH = headH + 5 + Math.max(measureUniverse(this.doc, rv, colW), measureUniverse(this.doc, lv, colW)) + 30
      this.need(Math.min(blockH, BOTTOM - M))
    } else {
      this.need(90)
    }
    this.doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(heading, M, this.y, { width: CONTENT_W, lineGap: 1 })
    this.y += headH + 5

    if (rv.type === "open_ended") {
      this.doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Open-ended · ${rv.openCount || 0} responses`, M, this.y)
      this.y += 12
      for (const s of (rv.openSamples || []).slice(0, 4)) {
        const q = `"${s}"`
        const h = this.doc.font("Helvetica-Oblique").fontSize(8).heightOfString(q, { width: CONTENT_W - 8 })
        this.need(h + 4)
        this.doc.font("Helvetica-Oblique").fontSize(8).fillColor("#4b5563").text(q, M + 6, this.y, { width: CONTENT_W - 8 })
        this.y += h + 4
      }
      this.y += 8
      return
    }
    if (rv.type === "numeric") {
      const f = (q: Question) => (q.numeric ? `mean ${q.numeric.mean}, median ${q.numeric.median}` : "—")
      this.doc.font("Helvetica").fontSize(9).fillColor(BODY).text(`Registered voters: ${f(rv)}    ·    Likely voters: ${f(lv)}`, M, this.y)
      this.y += 18
      return
    }

    const colW = (CONTENT_W - 22) / 2
    const startY = this.y
    const yL = drawUniverseBars(this.doc, "Registered voters", rv, M, startY, colW, false)
    const yR = drawUniverseBars(this.doc, "Likely voters", lv, M + colW + 22, startY, colW, true)
    this.y = Math.max(yL, yR) + 6
    const insight = toplineInsight(rv, lv)
    if (insight) this.prose(ascii(insight), true)
    else this.y += 6
  }
  shiftTable(rows: { cell: string; rv: number; pvote: number; lv: number }[]) {
    const cols = [
      { h: "2024 vote", w: CONTENT_W * 0.28, a: "left" as const },
      { h: "Registered", w: CONTENT_W * 0.18, a: "right" as const },
      { h: "After P(vote)", w: CONTENT_W * 0.18, a: "right" as const },
      { h: "Likely", w: CONTENT_W * 0.18, a: "right" as const },
      { h: "Net", w: CONTENT_W * 0.18, a: "right" as const },
    ]
    const data = rows.map((r) => {
      const net = r.lv - r.rv
      return [r.cell, `${r.rv.toFixed(1)}%`, `${r.pvote.toFixed(1)}%`, `${r.lv.toFixed(1)}%`, `${net > 0 ? "+" : ""}${net.toFixed(1)}`]
    })
    this.gridTable(cols, data)
  }
  uncertaintyBlocks(u: UncertaintyResult) {
    for (const q of u.questions) {
      this.need(28 + q.options.length * 12)
      this.doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(truncate(q.prompt, 92), M, this.y, { width: CONTENT_W })
      this.y += 13
      for (const o of q.options) {
        this.doc.font("Helvetica").fontSize(8).fillColor(BODY).text(
          `${truncate(o.label, 34)}    LV ${o.lv.toFixed(1)}% ± ${o.lvSe.toFixed(1)}   ·   range ${o.lvLow.toFixed(1)}–${o.lvHigh.toFixed(1)}%`,
          M + 8,
          this.y,
          { width: CONTENT_W - 8 },
        )
        this.y += 12
      }
      this.y += 8
    }
  }
  crosstab(ct: Crosstab) {
    const nCols = ct.columns.length
    const labelW = CONTENT_W * 0.32
    const colW = (CONTENT_W - labelW) / (nCols + 1)
    this.need(40 + ct.rows.length * 16)
    this.doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(`${truncate(ct.questionPrompt, 70)}  ×  ${ct.dimLabel}`, M, this.y, { width: CONTENT_W })
    this.y += this.doc.heightOfString(`${truncate(ct.questionPrompt, 70)}  ×  ${ct.dimLabel}`, { width: CONTENT_W }) + 4

    // header
    const startY = this.y
    const startBreaks = this.breaks
    this.doc.rect(M, this.y, CONTENT_W, 22).fill(NAVY)
    this.doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff").text("Option", M + 8, this.y + 7, { width: labelW - 12 })
    ct.columns.forEach((c, i) => {
      const x = M + labelW + i * colW
      this.doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff").text(truncate(c, 10), x, this.y + 4, { width: colW - 2, align: "right" })
      this.doc.font("Helvetica").fontSize(6.5).fillColor("#aab4cf").text(`n=${Math.round(ct.columnTotals[i] || 0)}`, x, this.y + 13, { width: colW - 2, align: "right" })
    })
    this.doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff").text("All", M + labelW + nCols * colW, this.y + 7, { width: colW - 2, align: "right" })
    this.y += 22
    ct.rows.forEach((row, ri) => {
      if (this.y + 15 > BOTTOM) this.addPage()
      if (ri % 2 === 1) this.doc.rect(M, this.y, CONTENT_W, 15).fill(ROW_ALT)
      this.doc.font("Helvetica").fontSize(7.5).fillColor(BODY).text(truncate(row.label, 34), M + 8, this.y + 4, { width: labelW - 12 })
      row.cells.forEach((cell, i) => {
        const x = M + labelW + i * colW
        if (cell.significant) this.doc.font("Helvetica-Bold").fillColor(PRIMARY)
        else this.doc.font("Helvetica").fillColor("#4b5563")
        this.doc.fontSize(7.5).text(`${cell.pct.toFixed(0)}%`, x, this.y + 4, { width: colW - 2, align: "right" })
      })
      this.doc.font("Helvetica").fontSize(7.5).fillColor(FAINT).text(`${row.all.pct.toFixed(0)}%`, M + labelW + nCols * colW, this.y + 4, { width: colW - 2, align: "right" })
      this.y += 15
    })
    if (this.breaks === startBreaks) {
      this.doc.rect(M, startY, CONTENT_W, this.y - startY).strokeColor(LINE).lineWidth(0.8).stroke()
      this.doc.moveTo(M + labelW, startY + 22).lineTo(M + labelW, this.y).strokeColor(LINE).lineWidth(0.4).stroke()
    }
    this.y += 14
  }
}

// ── universe bar column ────────────────────────────────────────────────────
function drawUniverseBars(doc: Doc, title: string, q: Question, x: number, y: number, w: number, accent: boolean): number {
  if (accent) {
    doc.circle(x + 3, y + 3, 2).fill(PRIMARY)
    doc.font("Helvetica-Bold").fontSize(8).fillColor(PRIMARY).text(title.toUpperCase(), x + 9, y, { characterSpacing: 0.4 })
  } else {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(title.toUpperCase(), x, y, { characterSpacing: 0.4 })
  }
  y += 14
  const neutralIdx = q.scaleMeta?.neutralIndex ?? -1
  const barW = w - 30
  // Hard cap so a question that slipped through with many options can never
  // overflow the page into blank/garbled pages. Upstream already folds long
  // categorical tails into "Other"; this is the renderer's own backstop.
  const shown = q.options.slice(0, MAX_REPORT_BARS)
  shown.forEach((o, idx) => {
    let color = PRIMARY
    if (q.type === "scale") {
      if (neutralIdx >= 0 && idx === neutralIdx) color = FAINT
      else if (neutralIdx >= 0) color = idx < neutralIdx ? NEG : POS
      else color = idx < q.options.length / 2 ? NEG : POS
      if (isNeutralLabel(o.label)) color = FAINT
    }
    // Label on its own line (wraps) so it never gets clipped, bar beneath it.
    const lbl = ascii(o.label)
    const lh = doc.font("Helvetica").fontSize(8).heightOfString(lbl, { width: w })
    doc.fillColor(INK).text(lbl, x, y, { width: w })
    y += lh + 1
    const pct = Math.max(0, Math.min(100, o.pct))
    doc.roundedRect(x, y + 1, barW, 6, 2).fill("#eef0f4")
    if (pct > 0) doc.roundedRect(x, y + 1, Math.max(2, (pct / 100) * barW), 6, 2).fill(color)
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(BODY).text(`${pct.toFixed(0)}%`, x + barW + 3, y, { width: 28, align: "left" })
    y += 11
  })
  const hidden = q.options.length - shown.length
  if (hidden > 0) {
    doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(MUTED).text(`+${hidden} more option${hidden === 1 ? "" : "s"} not shown`, x, y, { width: w })
    y += 11
  }
  return y
}

// Estimated height of a universe column for page-break planning.
function measureUniverse(doc: Doc, q: Question, w: number): number {
  let h = 14
  const shown = q.options.slice(0, MAX_REPORT_BARS)
  if (q.options.length > shown.length) h += 11 // "+N more" note
  for (const o of shown) h += doc.font("Helvetica").fontSize(8).heightOfString(ascii(o.label), { width: w }) + 1 + 11
  return h
}

// ── narrative helpers ─────────────────────────────────────────────────────
function toplineInsight(rv: Question, lv: Question): string {
  if (lv.type === "scale") {
    const net = (q: Question) => {
      const ni = q.scaleMeta?.neutralIndex ?? -1
      let pos = 0
      let neg = 0
      q.options.forEach((o, i) => {
        if (ni >= 0 ? i > ni : i >= q.options.length / 2) pos += o.pct
        else if (ni >= 0 ? i < ni : i < q.options.length / 2) neg += o.pct
      })
      return Math.round(pos - neg)
    }
    const rn = net(rv)
    const ln = net(lv)
    return `Net sentiment is ${ln > 0 ? "+" : ""}${ln} among likely voters (${rn > 0 ? "+" : ""}${rn} among registered voters), a ${Math.abs(ln - rn)}-point ${ln >= rn ? "shift toward the positive" : "shift toward the negative"} on the screen.`
  }
  const rvTop = rv.options.slice().sort((a, b) => b.pct - a.pct)[0]
  const lvTop = lv.options.slice().sort((a, b) => b.pct - a.pct)[0]
  if (!rvTop || !lvTop) return ""
  const lvForRvTop = lv.options.find((o) => o.label === rvTop.label)
  if (lvTop.label !== rvTop.label) {
    return `Registered voters lead with "${rvTop.label}" (${rvTop.pct.toFixed(0)}%), but likely voters favor "${lvTop.label}" (${lvTop.pct.toFixed(0)}%) — the screen flips the result.`
  }
  const delta = lvForRvTop ? lvForRvTop.pct - rvTop.pct : 0
  return `"${lvTop.label}" leads at ${lvTop.pct.toFixed(0)}% among likely voters${Math.abs(delta) >= 1 ? `, ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(0)} points from registered voters` : ", essentially unchanged from registered voters"}.`
}

function shiftInsight(rows: { cell: string; rv: number; lv: number }[]): string {
  const dnv = rows.find((r) => /dnv|did ?not/i.test(r.cell))
  const trump = rows.find((r) => /trump|republican/i.test(r.cell))
  const parts: string[] = []
  if (dnv) parts.push(`Non-voters compress from ${dnv.rv.toFixed(0)}% of the registered universe to ${dnv.lv.toFixed(0)}% of the likely electorate`)
  if (trump) parts.push(`2024 Trump voters rise from ${trump.rv.toFixed(0)}% to ${trump.lv.toFixed(0)}%`)
  return parts.length ? parts.join("; ") + " — the expected signature of a higher-propensity midterm electorate." : ""
}

function methodologyParts(p: ClientPayload): string[] {
  const dimText = p.weightingSet === "C" ? "Age×Sex, Race×Education, and 2024 recall" : p.weightingSet === "B" ? "Age×Sex, Education×Sex, Race×Education, Region, 2024 recall, and the Age×Education joint" : "Age×Sex, Education×Sex, Race×Education, Region, and 2024 recall"
  return [
    `Of ${p.quality.total.toLocaleString()} respondents, ${p.quality.removed.toLocaleString()} were screened out (${p.quality.speeders} speeders, ${p.quality.straightliners} straightliners), leaving ${p.quality.kept.toLocaleString()} analyzed.`,
    `The Registered-Voter and Likely-Voter universes are weighted independently. Each is initialized by entropy balancing from its base distribution (uniform for RV, the P(vote) distribution for LV) so all target moments are satisfied before raking, then raked over four rounds with a DEFF-informed cap (weighting Set ${p.weightingSet}) on ${dimText}, to SOCAL credibility-updated targets (70% prior / 30% observed, applied only beyond a 3-point divergence). Two-stage recall calibration sets 2024 voters to FEC certified shares; the RV universe also anchors the non-voter share to CPS, while the LV universe omits that anchor to avoid double-counting the propensity screen.`,
    `Likely-voter propensity is the geometric mean of three questions (motivation, preparedness, social environment), converted to P(vote) by a logistic curve whose steepness is set by 2024 vote history and whose midpoint is solved so mean P(vote) equals the projected turnout of ${(p.lv.projectedTurnout * 100).toFixed(1)}%.`,
    `Disclosure: this report applies the full likely-voter model, entropy-balancing initialization, independent SOCAL targets, four-round capped raking, two-stage recall calibration, a ${"9"}-scenario Monte Carlo grid, and bootstrap standard errors. The PSI 5,000-simulation probabilistic-inclusion variant and geographic-clustering ICC adjustment are not applied.`,
  ]
}

// ── primitives ─────────────────────────────────────────────────────────────
function truncate(s: string, n: number): string {
  const a = ascii(s)
  return a.length > n ? a.slice(0, n - 1) + "…" : a
}
function ascii(s: string): string {
  return String(s)
    .replace(/[←-⇿⟰-⟿⤀-⥿]/g, "->")
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”†‡•…‰‹›€™ŒœŠšŸŽžƒ]/g, "")
}
