import { NextResponse } from "next/server"
import { buildClientPayload, runAnalysis, type RunConfig } from "@/lib/psi/service"

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
  if (body.csvText.length > 24_000_000) {
    return NextResponse.json({ error: "CSV is too large (24 MB max)." }, { status: 413 })
  }
  try {
    const { csvText, ...config } = body
    const full = runAnalysis(csvText, config)
    return NextResponse.json({ payload: buildClientPayload(full) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not process the survey." }, { status: 422 })
  }
}
