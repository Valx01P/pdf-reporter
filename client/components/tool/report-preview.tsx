"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, ChevronDown, Download, FileSpreadsheet, FileText, HelpCircle, Loader2, RotateCcw, Sliders, Table2 } from "lucide-react"
import { downloadExport, type RunConfig } from "@/lib/client-api"

const GUIDE: { label: string; desc: string }[] = [
  {
    label: "What this is",
    desc: "Your uploaded survey is weighted two ways — Registered Voters (everyone eligible) and Likely Voters (weighted by each respondent's modelled turnout) — using the PSI Pathway 3 method, then turned into a publication-ready report.",
  },
  { label: "PDF report tab", desc: "The full formatted report: cover, executive summary, methodology, side-by-side RV/LV toplines, the likely-voter shift, uncertainty, diagnostics, and crosstabs. The Download button saves it as a PDF." },
  { label: "Excel tab", desc: "The tabulated numbers as a spreadsheet preview — the .xlsx download adds Summary, separate Registered/Likely topline sheets, and a crosstab sheet." },
  { label: "CSV tab", desc: "The raw tabulated data — one row per question option with unweighted, Registered, and Likely percentages. Downloads as a .csv." },
  { label: "Adjust methodology", desc: "Opens the advanced workspace to tune the weighting (likely-voter model, projected turnout, benchmark targets, weighting set). The report regenerates with your changes. Defaults already follow the Pathway 3 spec — most users never need this." },
  { label: "New upload", desc: "Clear everything and start over with a different CSV." },
]

type Tab = "pdf" | "excel" | "csv"

function slug(name: string): string {
  return (name || "toplines").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "toplines"
}

// Minimal quoted-CSV parser (handles "" escapes and commas inside quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ""))
}

export function ReportPreview({
  csvText,
  name,
  config,
  onAdvanced,
  onReset,
}: {
  csvText: string
  name: string
  config: RunConfig
  onAdvanced: () => void
  onReset: () => void
}) {
  const [tab, setTab] = useState<Tab>("pdf")
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)
  const [csvData, setCsvData] = useState<string | null>(null)
  const [csvLoading, setCsvLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [help, setHelp] = useState(false)

  const pdfReq = useRef(0)
  const csvReq = useRef(0)
  const urlRef = useRef<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cfgKey = JSON.stringify(config)

  const confirm = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }

  // Build the PDF whenever the data/config changes.
  useEffect(() => {
    const id = ++pdfReq.current
    setPdfLoading(true)
    setError(null)
    setCsvData(null) // invalidate the cached table/CSV too
    fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText, name, ...config }) })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `Could not build the report (${res.status}).`)
        }
        return res.blob()
      })
      .then((blob) => {
        if (id !== pdfReq.current) return
        const u = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = u
        setPdfUrl(u)
      })
      .catch((e) => id === pdfReq.current && setError(e.message))
      .finally(() => id === pdfReq.current && setPdfLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText, cfgKey, name])

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  // Lazily fetch the tabulated CSV the first time Excel/CSV is opened.
  const loadCsv = useCallback(() => {
    if (csvData != null || csvLoading) return
    const id = ++csvReq.current
    setCsvLoading(true)
    fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csvText, name, ...config, format: "csv" }) })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not build the data preview.")
        return res.text()
      })
      .then((t) => id === csvReq.current && setCsvData(t))
      .catch((e) => id === csvReq.current && setError(e.message))
      .finally(() => id === csvReq.current && setCsvLoading(false))
  }, [csvData, csvLoading, csvText, name, config])

  useEffect(() => {
    if (tab === "excel" || tab === "csv") loadCsv()
  }, [tab, loadCsv])

  // Optional deep-links for the preview tab / guide (e.g. /?demo=1&preview=excel).
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const p = params.get("preview")
    if (p === "excel" || p === "csv") setTab(p)
    if (params.get("guide") === "1") setHelp(true)
  }, [])

  const switchTab = (t: Tab) => {
    setTab(t)
    setError(null)
  }

  const doDownload = async () => {
    if (tab === "pdf") {
      if (!pdfUrl) return
      const file = `${slug(name)}-pathway3.pdf`
      const a = document.createElement("a")
      a.href = pdfUrl
      a.download = file
      document.body.appendChild(a)
      a.click()
      a.remove()
      confirm(`Downloaded ${file}`)
      return
    }
    if (tab === "csv") {
      if (!csvData) return
      const file = `${slug(name)}-toplines.csv`
      const blob = new Blob([csvData], { type: "text/csv" })
      const u = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = u
      a.download = file
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(u)
      confirm(`Downloaded ${file}`)
      return
    }
    // excel
    setExporting(true)
    try {
      await downloadExport({ csvText, name, ...config, format: "xlsx" })
      confirm(`Downloaded ${slug(name)}.xlsx`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof FileText; title: string }[] = [
    { id: "pdf", label: "PDF report", icon: FileText, title: "The full formatted report — cover, summary, methodology, toplines, shift, uncertainty, diagnostics, crosstabs." },
    { id: "excel", label: "Excel", icon: FileSpreadsheet, title: "Preview the tabulated numbers; download a multi-sheet .xlsx workbook." },
    { id: "csv", label: "CSV", icon: Table2, title: "The raw tabulated data — one row per question option with unweighted / RV / LV percentages." },
  ]
  const downloadLabel = tab === "pdf" ? "Download PDF" : tab === "excel" ? "Download .xlsx" : "Download .csv"

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/[0.02] p-0.5">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                title={t.title}
                onClick={() => switchTab(t.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-small font-medium transition-colors ${
                  active ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground"
                }`}
              >
                <t.icon size={13} className={active ? "text-primary" : ""} />
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setHelp((v) => !v)}
            aria-expanded={help}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-small font-medium transition-colors ${
              help ? "border-primary/30 bg-primary/[0.06] text-primary" : "border-foreground/15 text-foreground/70 hover:bg-foreground/5"
            }`}
          >
            <HelpCircle size={14} /> Guide
            <ChevronDown size={13} className={`transition-transform ${help ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={doDownload}
            title={`Save the ${tab === "pdf" ? "PDF report" : tab === "excel" ? "Excel workbook" : "CSV"} to your computer`}
            disabled={(tab === "pdf" && !pdfUrl) || (tab === "csv" && !csvData) || exporting}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {downloadLabel}
          </button>
          <button type="button" onClick={onAdvanced} title="Open the advanced workspace to change the weighting and methodology. Optional — the defaults follow the PSI Pathway 3 spec." className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5">
            <Sliders size={14} /> Adjust methodology
          </button>
          <button type="button" onClick={onReset} title="Clear everything and upload a different CSV" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5">
            <RotateCcw size={14} /> New upload
          </button>
        </div>
      </div>

      {help && (
        <div className="animate-fade-up rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {GUIDE.map((g) => (
              <div key={g.label} className="flex flex-col gap-0.5">
                <dt className="text-tiny font-semibold text-foreground/80">{g.label}</dt>
                <dd className="text-tiny text-foreground/60">{g.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {error}{" "}
            <button type="button" onClick={onAdvanced} className="underline underline-offset-2">
              Open advanced mode
            </button>{" "}
            to map columns.
          </span>
        </div>
      )}

      <div className="relative min-h-[70dvh] overflow-hidden rounded-lg border border-foreground/10 bg-foreground/[0.02]">
        {tab === "pdf" &&
          (pdfLoading && !pdfUrl ? (
            <Centered>Building your report…</Centered>
          ) : pdfUrl ? (
            <iframe src={`${pdfUrl}#toolbar=1&view=FitH`} title="Report preview" className="h-[70dvh] w-full" />
          ) : (
            <div className="h-[70dvh]" />
          ))}

        {tab === "excel" && (
          <div className="h-[70dvh] overflow-auto p-4">
            {csvLoading && !csvData ? (
              <Centered>Preparing the workbook preview…</Centered>
            ) : csvData ? (
              <>
                <p className="mb-3 text-tiny text-foreground/55">
                  Preview of the toplines sheet. The downloaded .xlsx also includes a Summary sheet, separate Registered- and Likely-Voter
                  topline sheets, and a crosstab sheet.
                </p>
                <DataTable rows={parseCsv(csvData)} />
              </>
            ) : null}
          </div>
        )}

        {tab === "csv" && (
          <div className="h-[70dvh] overflow-auto p-4">
            {csvLoading && !csvData ? (
              <Centered>Preparing the CSV…</Centered>
            ) : csvData ? (
              <pre className="w-max min-w-full whitespace-pre rounded-md bg-foreground/[0.03] p-3 font-mono text-tiny text-foreground/80">{csvData}</pre>
            ) : null}
          </div>
        )}
      </div>

      {toast && (
        <div className="animate-fade-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-background px-4 py-2 text-small font-medium text-foreground shadow-lg">
            <Check size={15} className="text-primary" />
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[70dvh] flex-col items-center justify-center gap-2">
      <Loader2 size={22} className="animate-spin text-primary" />
      <span className="text-small text-foreground/60">{children}</span>
    </div>
  )
}

function DataTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return null
  const [header, ...body] = rows
  return (
    <div className="overflow-x-auto rounded-lg border border-foreground/10">
      <table className="w-full text-tiny">
        <thead>
          <tr className="bg-foreground/[0.04] text-left text-foreground/60">
            {header.map((h, i) => (
              <th key={i} className="px-2.5 py-1.5 font-semibold uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/[0.06]">
          {body.map((r, ri) => (
            <tr key={ri} className="hover:bg-foreground/[0.02]">
              {header.map((_, ci) => (
                <td key={ci} className={`px-2.5 py-1.5 ${ci === 0 ? "max-w-[260px] text-foreground/75" : "whitespace-nowrap font-mono tabular-nums text-foreground/65"}`}>
                  {r[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
