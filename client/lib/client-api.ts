// Client-side wrappers around the route handlers. All processing is server-side;
// these shuttle JSON and trigger downloads. Types are imported type-only so no
// server module is bundled into the client.

import type { Crosstab, Tabbook } from "./types"
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

// Returns a respondent-level analysis `payload`, OR — when the upload is an
// already-processed export (tabbook or tidy toplines) — `aggregate: true` plus
// the parsed `tabbook` and which `kind` of aggregate it was.
export function runPipeline(
  args: RunArgs,
): Promise<{ payload?: ClientPayload; aggregate?: boolean; kind?: "tabbook" | "toplines"; tabbook?: Tabbook }> {
  return postJson("/api/run", args)
}

export function fetchCrosstab(
  args: RunArgs & { questionKey: string; banner: { key: string; label: string; isDemo: boolean }; universe: "RV" | "LV" | "both" },
): Promise<{ crosstab?: Crosstab; rv?: Crosstab; lv?: Crosstab }> {
  return postJson("/api/crosstab", args)
}

export function fetchTabbook(
  args: RunArgs & { universe?: "RV" | "LV" | "both"; banners?: { key: string; isDemo: boolean }[] },
): Promise<{ rv?: Tabbook; lv?: Tabbook; tabbook?: Tabbook }> {
  return postJson("/api/tabbook", args)
}

export function fetchSummary(args: RunArgs): Promise<{ summary: AiSummary }> {
  return postJson("/api/ai/summary", args)
}

export interface MappingSuggestion {
  field: string
  column: string | null
  reason: string
}

// AI-suggested column mappings for the fields the auto-detector left unfilled.
// `ai: false` means no key / no usable suggestion — the user maps manually.
export function fetchMappingSuggestions(
  args: RunArgs & { fields?: string[] },
): Promise<{ ai: boolean; suggestions: MappingSuggestion[] }> {
  return postJson("/api/ai/mapping", args)
}

export function fetchUncertainty(args: RunArgs & { bootstrap?: number }): Promise<{ uncertainty: UncertaintyResult }> {
  return postJson("/api/uncertainty", args)
}

export async function loadSample(): Promise<{ name: string; csvText: string }> {
  const res = await fetch("/api/sample")
  if (!res.ok) throw new ApiError("Could not load the sample dataset.")
  return res.json()
}

// The bytes for a generated file plus the server-suggested filename. Fetched
// without saving so the UI can preview the artifact before the user confirms.
export interface FetchedFile {
  blob: Blob
  filename: string
}

async function fetchFile(path: string, body: unknown, fallback: string): Promise<FetchedFile> {
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
  const filename = disp.match(/filename="([^"]+)"/)?.[1] || fallback
  return { blob, filename }
}

// Trigger a browser save for an already-fetched blob (no extra request).
export function saveBlob({ blob, filename }: FetchedFile) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function download(path: string, body: unknown, fallback: string) {
  saveBlob(await fetchFile(path, body, fallback))
}

export function fetchReportFile(args: RunArgs & { summary?: AiSummary | null; includeCrosstabs?: boolean; meta?: Record<string, string> }) {
  return fetchFile("/api/report", args, "toplines-pathway3.pdf")
}

export function downloadReport(args: RunArgs & { summary?: AiSummary | null; includeCrosstabs?: boolean; meta?: Record<string, string> }) {
  return download("/api/report", args, "toplines-pathway3.pdf")
}

export type ExportFormat =
  | "csv"
  | "xlsx"
  | "respondents"
  | "tabbook-rv"
  | "tabbook-lv"
  | "diagnostics"
  | "composition"

export function fetchExportFile(args: RunArgs & { format: ExportFormat; banners?: { key: string; isDemo: boolean }[] }) {
  return fetchFile("/api/export", args, args.format === "xlsx" ? "toplines.xlsx" : "toplines.csv")
}

export function downloadExport(args: RunArgs & { format: ExportFormat; banners?: { key: string; isDemo: boolean }[] }) {
  return download("/api/export", args, args.format === "xlsx" ? "toplines.xlsx" : "toplines.csv")
}
