// Client-side wrappers around the route handlers. All processing is server-side;
// these shuttle JSON and trigger downloads. Types are imported type-only so no
// server module is bundled into the client.

import type { Crosstab } from "./types"
import type { AiSummary } from "./types"
import type { ClientPayload, RunConfig } from "./psi/service"
import type { UncertaintyResult } from "./psi/uncertainty"

export type { ClientPayload, RunConfig, UncertaintyResult }

export class ApiError extends Error {}

export interface RunArgs extends RunConfig {
  csvText: string
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const d = await res.json()
      if (d?.error) message = d.error
    } catch {
      /* ignore */
    }
    throw new ApiError(message)
  }
  return res.json() as Promise<T>
}

export function runPipeline(args: RunArgs): Promise<{ payload: ClientPayload }> {
  return postJson("/api/run", args)
}

export function fetchCrosstab(
  args: RunArgs & { questionKey: string; banner: { key: string; label: string; isDemo: boolean }; universe: "RV" | "LV" | "both" },
): Promise<{ crosstab?: Crosstab; rv?: Crosstab; lv?: Crosstab }> {
  return postJson("/api/crosstab", args)
}

export function fetchSummary(args: RunArgs): Promise<{ summary: AiSummary }> {
  return postJson("/api/ai/summary", args)
}

export function fetchUncertainty(args: RunArgs & { bootstrap?: number }): Promise<{ uncertainty: UncertaintyResult }> {
  return postJson("/api/uncertainty", args)
}

export async function loadSample(): Promise<{ name: string; csvText: string }> {
  const res = await fetch("/api/sample")
  if (!res.ok) throw new ApiError("Could not load the sample dataset.")
  return res.json()
}

async function download(path: string, body: unknown, fallback: string) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) {
    let message = `Export failed (${res.status})`
    try {
      const d = await res.json()
      if (d?.error) message = d.error
    } catch {
      /* ignore */
    }
    throw new ApiError(message)
  }
  const blob = await res.blob()
  const disp = res.headers.get("Content-Disposition") || ""
  const name = disp.match(/filename="([^"]+)"/)?.[1] || fallback
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadReport(args: RunArgs & { summary?: AiSummary | null; includeCrosstabs?: boolean; meta?: Record<string, string> }) {
  return download("/api/report", args, "toplines-pathway3.pdf")
}

export function downloadExport(args: RunArgs & { format: "csv" | "xlsx" | "respondents" }) {
  return download("/api/export", args, args.format === "xlsx" ? "toplines.xlsx" : "toplines.csv")
}
