import { NextResponse } from "next/server"
import { buildTabbook, runAnalysis, type RunConfig } from "@/lib/psi/service"

export const runtime = "nodejs"
export const maxDuration = 60

interface Body extends RunConfig {
  csvText?: string
  universe?: "RV" | "LV" | "both"
  banners?: { key: string; isDemo: boolean }[]
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
    const { csvText, universe = "both", banners, ...config } = body
    const full = runAnalysis(csvText, config)
    if (universe === "both") {
      return NextResponse.json({ rv: buildTabbook(full, "RV", banners), lv: buildTabbook(full, "LV", banners) })
    }
    return NextResponse.json({ tabbook: buildTabbook(full, universe, banners) })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not build the tabbook." }, { status: 422 })
  }
}
