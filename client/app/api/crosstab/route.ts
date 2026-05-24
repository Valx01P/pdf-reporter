import { NextResponse } from "next/server"
import { buildOneCrosstab, runAnalysis, type RunConfig } from "@/lib/psi/service"
import type { Crosstab } from "@/lib/types"

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
  questionKey?: string
  banner?: { key: string; label: string; isDemo: boolean }
  universe?: "RV" | "LV" | "both"
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!body.csvText?.trim() || !body.questionKey || !body.banner) {
    return NextResponse.json({ error: "Provide csvText, questionKey, and banner." }, { status: 400 })
  }
  try {
    const { csvText, questionKey, banner, universe = "RV", ...config } = body
    const full = runAnalysis(csvText, config)
    if (universe === "both") {
      const rv = buildOneCrosstab(full, questionKey, banner, "RV")
      const lv = buildOneCrosstab(full, questionKey, banner, "LV")
      return NextResponse.json({ rv, lv })
    }
    const crosstab: Crosstab = buildOneCrosstab(full, questionKey, banner, universe)
    return NextResponse.json({ crosstab })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not build the crosstab." }, { status: 422 })
  }
}
