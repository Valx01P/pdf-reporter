import { NextResponse } from "next/server"
import { autoDetect, parseCsv } from "@/lib/psi/derive"
import { suggestMapping } from "@/lib/ai-mapping"
import type { RunConfig } from "@/lib/psi/service"
import type { ColumnMapping } from "@/lib/psi/types"

export const runtime = "nodejs"
export const maxDuration = 30

interface Body extends RunConfig {
  csvText?: string
  fields?: (keyof ColumnMapping)[]
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
    const parsed = parseCsv(body.csvText)
    // Effective current mapping = auto-detected + the user's overrides, matching
    // the analysis pipeline, so suggestions only target what's still unmapped.
    const overrides: Partial<ColumnMapping> = {}
    for (const [k, v] of Object.entries(body.mapping || {})) if (v) (overrides as Record<string, string>)[k] = v
    const mapping: ColumnMapping = { ...autoDetect(parsed), ...overrides }
    const result = await suggestMapping(parsed, mapping, body.fields)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not suggest a mapping." }, { status: 422 })
  }
}
