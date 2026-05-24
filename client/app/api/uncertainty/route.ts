import { NextResponse } from "next/server"
import { buildUncertainty, runAnalysis, type RunConfig } from "@/lib/psi/service"

export const runtime = "nodejs"
export const maxDuration = 120

interface Body extends RunConfig {
  csvText?: string
  bootstrap?: number
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim()) return NextResponse.json({ error: "Provide a CSV in `csvText`." }, { status: 400 })
  try {
    const { csvText, bootstrap, ...config } = body
    const full = runAnalysis(csvText, config)
    const uncertainty = buildUncertainty(full, bootstrap)
    return NextResponse.json({ uncertainty })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not run the uncertainty analysis." }, { status: 422 })
  }
}
