"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, FileText, Loader2, Sparkles, Table2, Users } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { downloadExport, downloadReport, fetchSummary, type ClientPayload, type RunConfig } from "@/lib/client-api"
import type { AiSummary } from "@/lib/types"

export function ReportPanel({ payload, csvText, name, config }: { payload: ClientPayload; csvText: string; name: string; config: RunConfig }) {
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [meta, setMeta] = useState({ pollster: "", client: "", fieldStart: "", fieldEnd: "" })
  const [includeCrosstabs, setIncludeCrosstabs] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const args = { csvText, name, ...config }

  const generate = async () => {
    setGenLoading(true)
    setError(null)
    try {
      const { summary } = await fetchSummary(args)
      setSummary(summary)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenLoading(false)
    }
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const exports = [
    { key: "pdf", label: "Topline report (PDF)", icon: FileText, hint: "Cover, exec summary, RV/LV toplines, methodology, diagnostics" + (includeCrosstabs ? ", crosstabs" : ""), fn: () => downloadReport({ ...args, summary, includeCrosstabs, meta }) },
    { key: "xlsx", label: "Workbook (Excel)", icon: FileSpreadsheet, hint: "Summary, RV & LV toplines, crosstabs sheets", fn: () => downloadExport({ ...args, format: "xlsx" }) },
    { key: "csv", label: "Toplines (CSV)", icon: Table2, hint: "Tidy question × option with RV / LV / unweighted %", fn: () => downloadExport({ ...args, format: "csv" }) },
    { key: "respondents", label: "Respondent-level (CSV)", icon: Users, hint: "Every row + weight_rv, weight_lv, p_vote", fn: () => downloadExport({ ...args, format: "respondents" }) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Executive summary"
          hint="AI-drafted from the dual-universe toplines — review before publishing"
          action={
            <button onClick={generate} disabled={genLoading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] px-2.5 text-tiny font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
              {genLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {summary ? "Regenerate" : "Generate"}
            </button>
          }
        />
        <CardBody>
          {!summary && !genLoading && <p className="text-small text-foreground/55">Generate an AI executive summary, then include it in the PDF. Without it, the report uses a deterministic template summary.</p>}
          {genLoading && <div className="flex items-center gap-2 text-small text-foreground/55"><Loader2 size={14} className="animate-spin text-primary" /> Drafting…</div>}
          {summary && (
            <div className="flex flex-col gap-3">
              <h3 className="text-h3 font-semibold">{summary.headline}</h3>
              <p className="text-small text-foreground/75">{summary.overview}</p>
              <ul className="flex flex-col gap-1.5">
                {summary.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-small text-foreground/70">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="text-tiny text-foreground/50">{summary.methodologyNote}</p>
              {!summary.ai && <p className="text-tiny text-foreground/45">Template summary (no AI key configured).</p>}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Report details" hint="Populates the PDF cover and methodology disclosure" />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([["pollster", "Pollster / firm"], ["client", "Client"], ["fieldStart", "Field start"], ["fieldEnd", "Field end"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-tiny text-foreground/60">{label}</span>
              <input
                value={meta[k]}
                onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))}
                className="h-9 rounded-md border border-foreground/15 bg-background px-2.5 text-small outline-none focus:border-primary/50"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-small text-foreground/70 sm:col-span-2">
            <input type="checkbox" checked={includeCrosstabs} onChange={(e) => setIncludeCrosstabs(e.target.checked)} className="accent-primary" />
            Include the full crosstab appendix in the PDF
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Export" hint="Everything runs server-side; downloads start immediately" />
        <CardBody className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {exports.map((e) => (
            <button
              key={e.key}
              onClick={() => run(e.key, e.fn)}
              disabled={busy !== null}
              className="group flex items-center gap-3 rounded-lg border border-foreground/10 px-3.5 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/[0.03] disabled:opacity-50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04] text-foreground/60 group-hover:text-primary">
                {busy === e.key ? <Loader2 size={16} className="animate-spin" /> : <e.icon size={16} />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-small font-medium group-hover:text-primary">
                  {e.label} <Download size={12} className="text-foreground/35" />
                </span>
                <span className="block truncate text-tiny text-foreground/50">{e.hint}</span>
              </span>
            </button>
          ))}
        </CardBody>
      </Card>

      {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">{error}</div>}
    </div>
  )
}
