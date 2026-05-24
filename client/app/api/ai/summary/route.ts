import { NextResponse } from "next/server"
import { buildClientPayload, runAnalysis, type RunConfig } from "@/lib/psi/service"
import { generatePsiSummary } from "@/lib/ai"

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim()) {
    return NextResponse.json({ error: "Provide a CSV in `csvText`." }, { status: 400 })
  }
  try {
    const { csvText, ...config } = body
    const full = runAnalysis(csvText, config)
    const payload = buildClientPayload(full)
    const summary = await generatePsiSummary(payload)
    return NextResponse.json({ summary })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not generate the summary." }, { status: 422 })
  }
}
