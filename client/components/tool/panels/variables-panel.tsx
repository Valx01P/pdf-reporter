"use client"

import { useMemo, useState } from "react"
import { ArrowRight, CheckCircle2, Database, Layers, RotateCcw, Scale, SlidersHorizontal, Sparkles } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import type { ClientPayload, RunConfig } from "@/lib/client-api"
import type { ColumnMapping } from "@/lib/psi/types"
import { IssuesReviewer } from "./issues-reviewer"

// The methodology variables the engine maps onto, in display order. Editable
// here so a mis-detected column can be reassigned before the report is built.
const FIELD_LABELS: { key: keyof ColumnMapping; label: string; hint: string }[] = [
  { key: "age", label: "Age", hint: "Age or age band — raked, and feeds the LV model" },
  { key: "sex", label: "Sex / Gender", hint: "Raked as Age×Sex and Education×Sex" },
  { key: "education", label: "Education", hint: "College / No College — raked" },
  { key: "race", label: "Race / ethnicity", hint: "Raked as Race×Education" },
  { key: "region", label: "Region", hint: "Census region — raked when it matches the benchmark" },
  { key: "state", label: "State", hint: "Used to derive region when no region column" },
  { key: "income", label: "Income", hint: "Optional crosstab banner" },
  { key: "party", label: "Party ID", hint: "Crosstab banner; weightable" },
  { key: "recall2024", label: "Past-vote recall", hint: "Partisan anchor (recalled presidential vote), not the ballot" },
  { key: "q2", label: "Vote history / frequency", hint: "How often / which elections — LV turnout signal" },
  { key: "q3", label: "Q3 · Motivation", hint: "Likely-voter screen (option-matched)" },
  { key: "q4", label: "Q4 · Preparedness", hint: "Likely-voter screen (option-matched)" },
  { key: "q5", label: "Q5 · Social", hint: "Likely-voter screen (option-matched)" },
]

export function VariablesPanel({
  payload,
  loading,
  csvText,
  name,
  config,
  onMapping,
  onApply,
  onContinue,
  onAdvanced,
}: {
  payload: ClientPayload
  loading: boolean
  csvText: string
  name: string
  config: RunConfig
  onMapping: (m: Partial<ColumnMapping>) => void
  onApply: (p: Partial<RunConfig>) => void
  onContinue: () => void
  onAdvanced: () => void
}) {
  const q = payload.quality
  const vars = payload.weightingVariables
  const varByKey = useMemo(() => new Map(vars.map((v) => [v.key, v])), [vars])

  // Which mapping field (if any) each header is assigned to — for a role badge.
  const roleByHeader = useMemo(() => {
    const m = new Map<string, string>()
    for (const { key, label } of FIELD_LABELS) {
      const h = payload.mapping[key]
      if (h) m.set(h, label)
    }
    return m
  }, [payload.mapping])

  // Columns the engine can weight/crosstab on (have a % breakdown) vs the rest
  // (IDs, zip codes, free numeric like an LV score, open-ended) shown for context.
  const weightableKeys = new Set(vars.map((v) => v.key))
  const otherColumns = payload.headers.filter((h) => !weightableKeys.has(h))

  // ── Custom weighting state (pick variables + enter your own % targets) ──
  const [picked, setPicked] = useState<string[]>([])
  const [targets, setTargets] = useState<Record<string, Record<string, string>>>({})

  const initTargets = (key: string): Record<string, string> => {
    const v = varByKey.get(key)
    const t: Record<string, string> = {}
    if (v) for (const c of v.categories) t[c.value] = String(c.pct)
    return t
  }
  const toggleVar = (key: string) => {
    const enabling = !picked.includes(key)
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))
    if (enabling) setTargets((t) => ({ ...t, [key]: t[key] ?? initTargets(key) }))
  }
  const setCell = (key: string, cat: string, val: string) =>
    setTargets((t) => ({ ...t, [key]: { ...(t[key] || {}), [cat]: val } }))
  const sumOf = (key: string) => Object.values(targets[key] || {}).reduce((s, x) => s + (parseFloat(x) || 0), 0)

  const buildCustom = (): RunConfig["customWeighting"] => {
    const cw = picked
      .map((key) => {
        const v = varByKey.get(key)
        if (!v) return null
        const tg: Record<string, number> = {}
        for (const [cat, val] of Object.entries(targets[key] || {})) tg[cat] = parseFloat(val) || 0
        return { key, label: v.label, isDemo: v.isDemo, targets: tg }
      })
      .filter((c): c is NonNullable<typeof c> => !!c && Object.keys(c.targets).length > 0)
    return cw.length ? cw : undefined
  }
  const proceed = (go: () => void) => {
    onApply({ customWeighting: buildCustom() })
    go()
  }
  const resetTargets = (key: string) => setTargets((t) => ({ ...t, [key]: initTargets(key) }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h3 font-bold">Review columns &amp; variables</h3>
          <p className="mt-1 max-w-2xl text-small text-foreground/60">
            We detected the methodology variables from your column headers. Confirm the mapping, see every column&apos;s
            category breakdown, and optionally weight on any variable to your own benchmark targets. Defaults follow the
            PSI spec, so this step is optional.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => proceed(onAdvanced)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5"
          >
            <SlidersHorizontal size={14} /> Advanced workspace
          </button>
          <button
            type="button"
            onClick={() => proceed(onContinue)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90"
          >
            Continue to report <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ["Total responses", q.total],
          ["Speeders removed", q.speeders],
          ["Straightliners removed", q.straightliners],
          ["Kept for analysis", q.kept],
        ] as const).map(([label, val]) => (
          <div key={label} className="rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2.5">
            <div className="text-tiny text-foreground/50">{label}</div>
            <div className="font-mono text-h3 font-bold tabular-nums">{val.toLocaleString()}</div>
          </div>
        ))}
      </div>

      <IssuesReviewer payload={payload} csvText={csvText} name={name} config={config} onMapping={onMapping} />

      <Card>
        <CardHeader title="Detected methodology variables" hint="Auto-detected from your headers and answer options. Reassign anything that's wrong — it changes what gets weighted and tabulated." />
        <CardBody className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_LABELS.map(({ key, label, hint }) => {
            const mapped = payload.mapping[key]
            return (
              <label key={key} className="flex flex-col gap-1" title={hint}>
                <span className="flex items-center gap-1.5 text-tiny font-medium text-foreground/60">
                  {mapped ? <CheckCircle2 size={11} className="text-primary" /> : <span className="size-[11px]" />}
                  {label}
                </span>
                <select
                  value={mapped || ""}
                  onChange={(e) => {
                    const next: Partial<ColumnMapping> = { ...payload.mapping }
                    if (e.target.value) next[key] = e.target.value
                    else delete next[key]
                    onMapping(next)
                  }}
                  className="h-9 rounded-md border border-foreground/15 bg-background px-2 text-small outline-none focus:border-primary/50"
                >
                  <option value="">— not mapped —</option>
                  {payload.headers.map((h) => (
                    <option key={h} value={h}>
                      {h.length > 46 ? h.slice(0, 45) + "…" : h}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Columns & weighting variables"
          hint="Every usable column with its category percentages. Toggle “Weight on this” to rake the sample to your own targets — this overrides the weighting set."
          action={
            picked.length ? (
              <span className="inline-flex items-center gap-1.5 text-tiny font-medium text-primary">
                <Scale size={12} /> {picked.length} variable{picked.length === 1 ? "" : "s"} selected
              </span>
            ) : undefined
          }
        />
        <CardBody className="flex flex-col gap-2.5">
          {vars.map((v) => {
            const on = picked.includes(v.key)
            const sum = sumOf(v.key)
            const balanced = Math.abs(sum - 100) < 0.5
            return (
              <div
                key={v.key}
                className={`rounded-lg border p-3 transition-colors ${on ? "border-primary/30 bg-primary/[0.03]" : "border-foreground/10"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-small font-medium" title={v.key}>
                    {v.isDemo ? <Database size={12} className="shrink-0 text-primary" /> : <Layers size={12} className="shrink-0 text-foreground/40" />}
                    <span className="truncate">{v.label}</span>
                    <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-tiny text-foreground/45">
                      {v.isDemo ? "demographic" : "survey question"}
                    </span>
                    {roleByHeader.get(v.key) && !v.isDemo && (
                      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-tiny text-primary">{roleByHeader.get(v.key)}</span>
                    )}
                  </span>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-tiny font-medium text-foreground/70">
                    <input type="checkbox" checked={on} onChange={() => toggleVar(v.key)} className="accent-primary" />
                    Weight on this
                  </label>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {v.categories.map((c) => (
                    <div key={c.value} className="flex items-center gap-2 text-tiny">
                      <span className="min-w-0 flex-1 truncate text-foreground/70" title={c.value}>{c.label}</span>
                      {on ? (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={targets[v.key]?.[c.value] ?? ""}
                            onChange={(e) => setCell(v.key, c.value, e.target.value)}
                            className="h-7 w-16 rounded border border-foreground/15 bg-background px-1.5 text-right font-mono outline-none focus:border-primary/50"
                          />
                          <span className="text-foreground/40">%</span>
                        </>
                      ) : (
                        <span className="font-mono tabular-nums text-foreground/45">{c.pct.toFixed(1)}%</span>
                      )}
                    </div>
                  ))}
                </div>

                {on && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-foreground/[0.06] pt-2">
                    <span className={`font-mono text-tiny ${balanced ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}>
                      target sum {sum.toFixed(1)}% {balanced ? "" : "(auto-normalized)"}
                    </span>
                    <button
                      type="button"
                      onClick={() => resetTargets(v.key)}
                      className="inline-flex items-center gap-1 text-tiny text-foreground/50 hover:text-foreground/80"
                    >
                      <RotateCcw size={11} /> reset to observed
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {otherColumns.length > 0 && (
            <div className="mt-1 border-t border-foreground/[0.06] pt-2">
              <div className="mb-1 text-tiny font-medium text-foreground/45">Other columns (IDs, numeric, or free-text — not weightable)</div>
              <div className="flex flex-wrap gap-1.5">
                {otherColumns.map((h) => (
                  <span key={h} className="max-w-[240px] truncate rounded-full border border-foreground/10 px-2 py-0.5 text-tiny text-foreground/45" title={h}>
                    {roleByHeader.get(h) ? `${roleByHeader.get(h)}: ` : ""}{h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] px-4 py-3">
        <p className="text-tiny text-foreground/55">
          {picked.length
            ? `Custom weighting on ${picked.length} variable${picked.length === 1 ? "" : "s"} — RV and LV are raked to your targets (overrides the weighting set).`
            : "No custom weighting — the report uses the PSI default weighting set. You can still change this later in the Advanced workspace."}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => proceed(onAdvanced)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5"
          >
            <SlidersHorizontal size={14} /> Advanced workspace
          </button>
          <button
            type="button"
            onClick={() => proceed(onContinue)}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles size={14} /> Continue to report <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
