import { buildAllCrosstabs, buildClientPayload, buildUncertainty, runAnalysis, type RunConfig } from "@/lib/psi/service"
import { buildReportPdf } from "@/lib/pdf"
import { templatePsiSummary } from "@/lib/ai"
import { looksLikeAggregate } from "@/lib/psi/aggregate-parse"
import type { AiSummary } from "@/lib/types"

const AGGREGATE_MESSAGE =
  "This file is already-processed results (a tabbook or toplines export), not respondent-level data — so the Pathway 3 methodology report can't be rebuilt from it. It opens directly in the results viewer; to generate a full report, upload the respondent-level CSV (one row per person)."

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
  summary?: AiSummary | null
  includeCrosstabs?: boolean
  includeUncertainty?: boolean
  meta?: { client?: string; pollster?: string; fieldStart?: string; fieldEnd?: string }
}

function filename(name: string): string {
  const base = (name || "toplines").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  return `${base || "toplines"}-pathway3.pdf`
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim()) return Response.json({ error: "Provide a CSV in `csvText`." }, { status: 400 })
  if (looksLikeAggregate(body.csvText)) return Response.json({ error: AGGREGATE_MESSAGE }, { status: 422 })
  try {
    const { csvText, summary, includeCrosstabs, includeUncertainty, meta, ...config } = body
    const full = runAnalysis(csvText, config)
    const payload = buildClientPayload(full)
    // Always include a summary so the one-click PDF is complete; callers can
    // pass an AI-generated one, otherwise fall back to the deterministic template.
    const reportSummary = summary ?? templatePsiSummary(payload)
    // Focused crosstabs (Age, 2024 recall, Education) keep the appendix tight.
    const crosstabs = includeCrosstabs === false ? [] : buildAllCrosstabs(full, "RV", ["ageBucket", "recall", "edu"])
    const uncertainty = includeUncertainty === false ? null : buildUncertainty(full, 120)
    const pdf = await buildReportPdf({ payload, summary: reportSummary, crosstabs, uncertainty, meta })
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename(payload.name)}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Could not build the report." }, { status: 422 })
  }
}
