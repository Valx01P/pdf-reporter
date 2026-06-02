"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Database,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Loader2,
  Scale,
  Table2,
  TrendingUp,
  Users,
} from "lucide-react"
import { ApiError, loadSample, runPipeline, type ClientPayload, type RunConfig } from "@/lib/client-api"
import { Container } from "@/components/layout/container"
import { StatBar, StatTile } from "@/components/ui/stat-tile"
import { UploadPanel } from "./panels/upload-panel"
import { DashboardPanel } from "./panels/dashboard-panel"
import { DataPanel } from "./panels/data-panel"
import { VariablesPanel } from "./panels/variables-panel"
import { LvPanel } from "./panels/lv-panel"
import { WeightingPanel } from "./panels/weighting-panel"
import { ResultsPanel } from "./panels/results-panel"
import { CrosstabPanel } from "./panels/crosstab-panel"
import { ReportPanel } from "./panels/report-panel"
import { ReportPreview } from "./report-preview"

type View = "overview" | "data" | "lv" | "weighting" | "results" | "crosstabs" | "report"
type Mode = "review" | "preview" | "advanced"

const TABS: { id: View; label: string; icon: typeof Database; guide: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, guide: "The poll-at-a-glance dashboard: the auto-detected ballot question as a flagship (leader and margin), candidate topline tiles with the RV→LV movement, headline diagnostics, and the ballot crossed by any demographic. Switch the universe or pick a different question to drive the dashboard." },
  { id: "data", label: "Data", icon: Database, guide: "The quality screen (speeders and straightliners removed) and the auto-detected column mapping. Reassign a column if something was detected wrong — that changes what gets weighted and tabulated." },
  { id: "lv", label: "Likely Voter", icon: Users, guide: "The turnout model: the P(vote) distribution, vote-history buckets, and editable Q3/Q4/Q5 weight maps, projected turnout, and steepness (k). Raising turnout or weights pulls more respondents into the likely electorate; the whole report recomputes." },
  { id: "weighting", label: "Benchmarks & Weighting", icon: Scale, guide: "Choose the weighting set (A/B/C) and review the raking diagnostics, convergence log, recall calibration, and SOCAL target derivation. The set determines which demographics the sample is weighted to." },
  { id: "results", label: "Results", icon: BarChart3, guide: "Read-only output: the weighted toplines for both universes side by side, the RV→LV shift, and the Monte Carlo + bootstrap uncertainty." },
  { id: "crosstabs", label: "Crosstabs", icon: Table2, guide: "The Tabbook: every question's Total on the left and all demographic banner columns to the right, in one wide grid. Toggle banners, switch universe, and download the RV/LV tabbook CSV. Cells in brand color are statistically significant." },
  { id: "report", label: "Report", icon: FileText, guide: "Generate the AI executive summary and download the PDF, Excel workbook, or CSV." },
]

const WORKSPACE_INTRO =
  "The advanced workspace. Your report is built from these steps — here you can inspect each one and change the weighting inputs. Every change re-runs the Pathway 3 pipeline and updates the report. Defaults follow the PSI spec, so changes are optional."

export function Workspace() {
  const [csvText, setCsvText] = useState("")
  const [name, setName] = useState("")
  const [config, setConfig] = useState<RunConfig>({})
  const [payload, setPayload] = useState<ClientPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>("overview")
  const [mode, setMode] = useState<Mode>("preview")
  const [helpOpen, setHelpOpen] = useState(false)
  const reqId = useRef(0)

  const run = useCallback(async (text: string, studyName: string, cfg: RunConfig) => {
    if (!text.trim()) return
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const { payload } = await runPipeline({ csvText: text, name: studyName, ...cfg })
      if (id === reqId.current) setPayload(payload)
    } catch (e) {
      if (id === reqId.current) setError(e instanceof ApiError ? e.message : "Something went wrong processing the survey.")
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  // The review step and advanced workspace need the analysis payload; the PDF
  // preview only needs the PDF (fetched inside ReportPreview), so we skip the
  // analysis call there.
  const configKey = JSON.stringify(config)
  useEffect(() => {
    if (csvText && (mode === "advanced" || mode === "review")) run(csvText, name, config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText, configKey, mode])

  const onData = (text: string, studyName: string) => {
    setName(studyName)
    setConfig({})
    setPayload(null)
    setCsvText(text)
    setMode("review") // land on the column/variable review page after upload
    setView("overview")
  }

  const onLoadSample = useCallback(async () => {
    setLoading(true)
    try {
      const s = await loadSample()
      onData(s.csvText, s.name)
    } catch {
      setError("Could not load the sample dataset.")
    } finally {
      setLoading(false)
    }
  }, [])

  // Shareable links: /?demo=1 → example PDF preview; /?demo=1&tab=results → advanced.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("demo") !== "1") return
    const tab = params.get("tab") as View | null
    const wantsGuide = params.get("guide") === "1"
    onLoadSample().then(() => {
      if (tab && TABS.some((t) => t.id === tab)) {
        setView(tab)
        setMode("advanced")
        if (wantsGuide) setHelpOpen(true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onLoadSample])

  const patchConfig = (patch: Partial<RunConfig>) => setConfig((c) => ({ ...c, ...patch }))
  const reset = () => {
    setCsvText("")
    setPayload(null)
    setError(null)
    setName("")
    setConfig({})
    setHelpOpen(false)
    setMode("preview")
  }

  // The header logo dispatches this to return to the upload screen in place.
  useEffect(() => {
    const onHome = () => reset()
    window.addEventListener("toplines:home", onHome)
    return () => window.removeEventListener("toplines:home", onHome)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Upload screen ──
  if (!csvText) {
    return (
      <section className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center px-4 py-10">
        <Container>
          <UploadPanel onData={onData} onLoadSample={onLoadSample} loading={loading} error={error} />
        </Container>
      </section>
    )
  }

  // ── Column / variable review (first stop after upload) ──
  if (mode === "review") {
    return (
      <section className="py-6">
        <Container>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-tiny font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                PSI Pathway 3 · Dual Universe
              </div>
              <h2 className="truncate text-h2 font-bold">{payload?.name || name || "Survey"}</h2>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5"
            >
              New upload
            </button>
          </div>
          {error && (
            <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">{error}</div>
          )}
          {!payload && <PanelSkeleton />}
          {payload && (
            <div className="animate-fade-up">
              <VariablesPanel
                payload={payload}
                loading={loading}
                csvText={csvText}
                name={name}
                config={config}
                onMapping={(m) => patchConfig({ mapping: m })}
                onApply={patchConfig}
                onContinue={() => setMode("preview")}
                onAdvanced={() => setMode("advanced")}
              />
            </div>
          )}
        </Container>
      </section>
    )
  }

  // ── PDF preview ──
  if (mode === "preview") {
    return (
      <section className="py-6">
        <Container>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-tiny font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                PSI Pathway 3 · Dual Universe
              </div>
              <h2 className="truncate text-h2 font-bold">{name || "Report"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setMode("review")}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5"
            >
              <Database size={14} /> Columns &amp; variables
            </button>
          </div>
          <ReportPreview csvText={csvText} name={name} config={config} onAdvanced={() => setMode("advanced")} onReset={reset} />
        </Container>
      </section>
    )
  }

  // ── Advanced workspace ──
  return (
    <section className="py-6">
      <Container>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-tiny font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              PSI Pathway 3 · Dual Universe
            </div>
            <h2 className="truncate text-h2 font-bold">{payload?.name || name || "Survey"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              aria-expanded={helpOpen}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-small font-medium transition-colors ${
                helpOpen ? "border-primary/30 bg-primary/[0.06] text-primary" : "border-foreground/15 text-foreground/70 hover:bg-foreground/5"
              }`}
            >
              <HelpCircle size={14} /> Guide
              <ChevronDown size={13} className={`transition-transform ${helpOpen ? "rotate-180" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setMode("preview")}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.06] px-3 text-small font-medium text-primary hover:bg-primary/10"
            >
              <FileText size={14} /> PDF report
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5"
            >
              New upload
            </button>
          </div>
        </div>

        {payload && (
          <div className="mt-4">
            <StatBar>
              <StatTile label="Kept sample" value={payload.quality.kept.toLocaleString()} hint={`${payload.quality.removed} screened out`} icon={Database} title="Respondents kept after the quality screen removed speeders and straightliners." />
              <StatTile label="RV effective n" value={payload.rv.diagnostics.effectiveN.toLocaleString()} hint={`±${payload.rv.diagnostics.moe}% · DEFF ${payload.rv.diagnostics.deff}`} icon={Users} title="Registered-Voter sample's real statistical power after weighting — it drives the margin of error." />
              <StatTile label="LV effective n" value={payload.lvUniverse.diagnostics.effectiveN.toLocaleString()} hint={`±${payload.lvUniverse.diagnostics.moe}% · DEFF ${payload.lvUniverse.diagnostics.deff}`} icon={Users} title="Likely-Voter sample's real statistical power after weighting and the turnout screen." />
              <StatTile label="Mean P(vote)" value={payload.lv.model.meanPvote.toFixed(2)} hint={`${payload.toplines.length} questions`} icon={TrendingUp} title="Average modelled probability of voting across respondents — calibrated to the projected turnout." />
            </StatBar>
          </div>
        )}

        {payload && payload.warnings.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-primary/30 bg-primary/[0.05] px-3 py-2.5">
            {payload.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 text-tiny text-foreground/70">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-primary" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="sticky top-0 z-20 -mx-1 mb-4 mt-4 flex flex-wrap items-center gap-2 border-b border-foreground/10 bg-background/95 px-1 py-2 backdrop-blur">
          <div role="tablist" className="psi-shadow flex flex-wrap items-center gap-1 rounded-md border border-foreground/10 bg-surface p-0.5">
            {TABS.map((t) => {
              const active = view === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  title={t.guide}
                  onClick={() => setView(t.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-tiny font-medium transition-colors ${
                    active ? "bg-primary text-white shadow-sm" : "text-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground"
                  }`}
                >
                  <t.icon size={12} className={active ? "text-white" : ""} />
                  {t.label}
                </button>
              )
            })}
          </div>
          {loading && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-tiny text-foreground/55">
              <Loader2 size={12} className="animate-spin text-primary" /> Recomputing…
            </span>
          )}
        </div>

        {helpOpen && (
          <div className="animate-fade-up mb-4 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-4">
            <p className="mb-3 text-tiny text-foreground/60">{WORKSPACE_INTRO}</p>
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
              {TABS.map((t) => (
                <div key={t.id} className="flex flex-col gap-0.5">
                  <dt className="flex items-center gap-1.5 text-tiny font-semibold text-foreground/80">
                    <t.icon size={12} className="text-primary" />
                    {t.label}
                  </dt>
                  <dd className="text-tiny text-foreground/60">{t.guide}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-small text-rose-700 dark:text-rose-300">{error}</div>
        )}

        {!payload && loading && <PanelSkeleton />}
        {payload && (
          <div className="animate-fade-up">
            {view === "overview" && <DashboardPanel payload={payload} csvText={csvText} name={name} config={config} />}
            {view === "data" && <DataPanel payload={payload} onMapping={(m) => patchConfig({ mapping: m })} />}
            {view === "lv" && <LvPanel payload={payload} onApply={patchConfig} />}
            {view === "weighting" && <WeightingPanel payload={payload} onApply={patchConfig} />}
            {view === "results" && <ResultsPanel payload={payload} csvText={csvText} name={name} config={config} />}
            {view === "crosstabs" && <CrosstabPanel payload={payload} csvText={csvText} name={name} config={config} />}
            {view === "report" && <ReportPanel payload={payload} csvText={csvText} name={name} config={config} />}
          </div>
        )}
      </Container>
    </section>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl border border-foreground/10 bg-foreground/[0.03]" />
      ))}
    </div>
  )
}
