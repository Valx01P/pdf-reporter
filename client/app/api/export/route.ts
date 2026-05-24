import { buildAllCrosstabs, buildClientPayload, runAnalysis, type RunConfig } from "@/lib/psi/service"
import { buildRespondentCsv, buildToplinesCsv, buildWorkbook } from "@/lib/exports"

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
  format?: "csv" | "xlsx" | "respondents"
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
  const format = body.format === "xlsx" ? "xlsx" : body.format === "respondents" ? "respondents" : "csv"
  try {
    const { csvText, ...config } = body
    const full = runAnalysis(csvText, config)
    const base = slug(full.result.name)

    if (format === "respondents") {
      const csv = buildRespondentCsv(full)
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-respondents.csv"`, "Cache-Control": "no-store" },
      })
    }
    if (format === "csv") {
      const csv = buildToplinesCsv(buildClientPayload(full))
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}-toplines.csv"`, "Cache-Control": "no-store" },
      })
    }
    const payload = buildClientPayload(full)
    const crosstabs = buildAllCrosstabs(full, "RV")
    const xlsx = await buildWorkbook(payload, crosstabs)
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
