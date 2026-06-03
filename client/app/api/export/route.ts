import { buildAllCrosstabs, buildBalance, buildClientPayload, buildTabbook, runAnalysis, type RunConfig } from "@/lib/psi/service"
import {
  buildCompositionCsv,
  buildDiagnosticsCsv,
  buildRespondentCsv,
  buildTabbookCsv,
  buildToplinesCsv,
  buildWorkbook,
} from "@/lib/exports"
import { detectAggregate, serializeToplinesCsv } from "@/lib/psi/aggregate-parse"

export const runtime = "nodejs"
export const maxDuration = 60

type Format = "csv" | "xlsx" | "respondents" | "tabbook-rv" | "tabbook-lv" | "diagnostics" | "composition"

interface Body extends RunConfig {
  csvText?: string
  format?: Format
  banners?: { key: string; isDemo: boolean }[]
}

const FORMATS: Format[] = ["csv", "xlsx", "respondents", "tabbook-rv", "tabbook-lv", "diagnostics", "composition"]

function csvResponse(csv: string, filename: string) {
  // Prepend a UTF-8 BOM so Excel renders the em dashes / × / curly quotes.
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

function slug(name: string): string {
  return (name || "toplines").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "toplines"
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim()) return Response.json({ error: "Provide a CSV in `csvText`." }, { status: 400 })
  const format: Format = FORMATS.includes(body.format as Format) ? (body.format as Format) : "csv"
  try {
    const { csvText, banners, ...config } = body

    // Aggregate upload (tabbook or toplines): there are no respondents to
    // re-tabulate, so the only faithful export is the data itself, normalized
    // back through its own writer.
    const aggregate = detectAggregate(csvText, config.name || "Tabbook")
    if (aggregate) {
      const aggBase = slug(aggregate.tabbook.name)
      if (aggregate.kind === "toplines") {
        return csvResponse(serializeToplinesCsv(aggregate.tabbook), `${aggBase}-toplines.csv`)
      }
      if (format === "csv" || format === "tabbook-rv" || format === "tabbook-lv" || format === "xlsx") {
        return csvResponse(buildTabbookCsv(aggregate.tabbook), `${aggBase}-${aggregate.tabbook.universe}-tabbook.csv`)
      }
      return Response.json(
        { error: "That export needs respondent-level data. An aggregate file can only be re-exported in its own format." },
        { status: 422 },
      )
    }

    const full = runAnalysis(csvText, config)
    const base = slug(full.result.name)

    if (format === "respondents") return csvResponse(buildRespondentCsv(full), `${base}-respondents.csv`)
    if (format === "csv") return csvResponse(buildToplinesCsv(buildClientPayload(full)), `${base}-toplines.csv`)
    if (format === "tabbook-rv") return csvResponse(buildTabbookCsv(buildTabbook(full, "RV", banners)), `${base}-RV-tabbook.csv`)
    if (format === "tabbook-lv") return csvResponse(buildTabbookCsv(buildTabbook(full, "LV", banners)), `${base}-LV-tabbook.csv`)
    if (format === "diagnostics")
      return csvResponse(buildDiagnosticsCsv(buildClientPayload(full), buildBalance(full, "RV"), buildBalance(full, "LV")), `${base}-diagnostics.csv`)
    if (format === "composition") return csvResponse(buildCompositionCsv(buildClientPayload(full)), `${base}-electorate.csv`)

    const payload = buildClientPayload(full)
    const crosstabs = buildAllCrosstabs(full, "RV")
    const xlsx = await buildWorkbook(payload, crosstabs, {
      tabbookRv: buildTabbook(full, "RV", banners),
      tabbookLv: buildTabbook(full, "LV", banners),
      balanceRv: buildBalance(full, "RV"),
      balanceLv: buildBalance(full, "LV"),
    })
    return new Response(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Could not build the export." }, { status: 422 })
  }
}
