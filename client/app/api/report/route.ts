import { buildAllCrosstabs, buildClientPayload, buildUncertainty, runAnalysis, type RunConfig } from "@/lib/psi/service"
import { buildReportPdf, buildTabbookPdf } from "@/lib/pdf"
import { templatePsiSummary } from "@/lib/ai"
import { detectAggregate } from "@/lib/psi/aggregate-parse"
import type { AiSummary } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
  summary?: AiSummary | null
  includeCrosstabs?: boolean
  includeUncertainty?: boolean
  meta?: { client?: string; pollster?: string; fieldStart?: string; fieldEnd?: string }
}

function slug(name: string): string {
  return (name || "toplines").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "toplines"
}
function filename(name: string): string {
  return `${slug(name)}-pathway3.pdf`
}

function pdfResponse(pdf: Buffer, name: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  })
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim()) return Response.json({ error: "Provide a CSV in `csvText`." }, { status: 400 })
  try {
    const { csvText, summary, includeCrosstabs, includeUncertainty, meta, ...config } = body

    // Already-processed export (tabbook or toplines): there are no respondents to
    // re-model, so we render the uploaded grid straight to PDF instead of the
    // methodology report. The user gets the numbers in a PDF — which is the ask.
    const aggregate = detectAggregate(csvText, config.name || "Tabbook")
    if (aggregate) {
      const pdf = await buildTabbookPdf({ tabbook: aggregate.tabbook, kind: aggregate.kind, meta })
      const suffix = aggregate.kind === "toplines" ? "toplines" : `${aggregate.tabbook.universe}-tabbook`
      return pdfResponse(pdf, `${slug(aggregate.tabbook.name)}-${suffix}.pdf`)
    }

    const full = runAnalysis(csvText, config)
    const payload = buildClientPayload(full)
    // Always include a summary so the one-click PDF is complete; callers can
    // pass an AI-generated one, otherwise fall back to the deterministic template.
    const reportSummary = summary ?? templatePsiSummary(payload)
    // Focused crosstabs (Age, 2024 recall, Education) keep the appendix tight.
    const crosstabs = includeCrosstabs === false ? [] : buildAllCrosstabs(full, "RV", ["ageBucket", "recall", "edu"])
    const uncertainty = includeUncertainty === false ? null : buildUncertainty(full, 120)
    const pdf = await buildReportPdf({ payload, summary: reportSummary, crosstabs, uncertainty, meta })
    return pdfResponse(pdf, filename(payload.name))
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Could not build the report." }, { status: 422 })
  }
}
