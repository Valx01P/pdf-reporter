"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, SlidersHorizontal } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import type { ClientPayload, RunConfig } from "@/lib/client-api"
import type { Diagnostics } from "@/lib/psi/types"

const DIM_LABEL: Record<string, string> = {
  ageSex: "Age × Sex",
  eduSex: "Education × Sex",
  raceEdu: "Race × Education",
  region: "Region",
  recall2024: "2024 recall",
}

function DiagColumn({ title, d, accent }: { title: string; d: Diagnostics; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`text-tiny font-semibold uppercase tracking-wider ${accent ? "text-primary" : "text-foreground/50"}`}>{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["Effective n", d.effectiveN.toLocaleString()],
          ["DEFF", String(d.deff)],
          ["Margin of error", `±${d.moe}%`],
          ["Weight range", `${d.weightMin}–${d.weightMax}`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-md bg-foreground/[0.03] px-2.5 py-1.5">
            <div className="text-tiny text-foreground/50">{l}</div>
            <div className="font-mono text-small font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex flex-col gap-1">
        {d.smd.map((s) => (
          <div key={s.dimension} className="flex items-center gap-1.5 text-tiny">
            {s.balanced ? <CheckCircle2 size={11} className="text-primary" /> : <CircleAlert size={11} className="text-rose-500" />}
            <span className="text-foreground/65">{DIM_LABEL[s.dimension] || s.dimension}</span>
            <span className="ml-auto font-mono text-foreground/45">SMD {s.maxSmd}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WeightingPanel({ payload, onApply }: { payload: ClientPayload; onApply: (p: Partial<RunConfig>) => void }) {
  const [socalDim, setSocalDim] = useState("recall2024")
  const audit = payload.socal.rv[socalDim] || []

  // ── Custom weighting builder state ──────────────────────────────────────────
  const vars = payload.weightingVariables
  const varByKey = useMemo(() => new Map(vars.map((v) => [v.key, v])), [vars])
  const [customOn, setCustomOn] = useState(false)
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
    // Re-prefill from the current observed composition each time a variable is
    // enabled, so stale edits/categories from a prior run aren't silently reused.
    if (enabling) setTargets((t) => ({ ...t, [key]: initTargets(key) }))
  }
  const setCell = (key: string, cat: string, val: string) =>
    setTargets((t) => ({ ...t, [key]: { ...(t[key] || {}), [cat]: val } }))
  const sumOf = (key: string) => Object.values(targets[key] || {}).reduce((s, x) => s + (parseFloat(x) || 0), 0)
  const applyCustom = () => {
    const cw = picked
      .map((key) => {
        const v = varByKey.get(key)
        if (!v) return null
        const tg: Record<string, number> = {}
        for (const [cat, val] of Object.entries(targets[key] || {})) tg[cat] = parseFloat(val) || 0
        return { key, label: v.label, isDemo: v.isDemo, targets: tg }
      })
      .filter((c): c is NonNullable<typeof c> => !!c && Object.keys(c.targets).length > 0)
    onApply({ customWeighting: cw.length ? cw : undefined })
  }
  const clearCustom = () => {
    setCustomOn(false)
    setPicked([])
    onApply({ customWeighting: undefined })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Weighting set" hint="Set B (41 cells) is preferred for Pathway 3; Set A (33 cells) is fully specified" />
        <CardBody className="flex flex-wrap items-center gap-2">
          {([
            ["A", "Set A — 33 cells (Age×Sex, Education×Sex, Race×Education, Region, 2024 recall). Fully specified."],
            ["B", "Set B — adds the Age×Education joint (41 cells). Recommended for Pathway 3."],
            ["C", "Set C — leaner 21-cell set (Age×Sex, Race×Education, 2024 recall). Lower design effect, less correction."],
          ] as const).map(([s, tip]) => {
            const active = payload.weightingSet === s
            return (
              <button
                key={s}
                title={tip}
                onClick={() => onApply({ weightingSet: s, customWeighting: undefined })}
                className={`inline-flex h-9 items-center rounded-md border px-4 text-small font-medium ${
                  active ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-foreground/15 text-foreground/70 hover:bg-foreground/5"
                }`}
              >
                Set {s}
              </button>
            )
          })}
          {customOn && <span className="text-tiny text-amber-600 dark:text-amber-400">Custom weighting overrides the set until you reset.</span>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Custom weighting"
          hint="Pick weighting variables from your columns and enter your own benchmark targets — overrides the weighting set above"
          action={
            <label className="flex cursor-pointer items-center gap-1.5 text-tiny text-foreground/70">
              <input type="checkbox" checked={customOn} onChange={(e) => setCustomOn(e.target.checked)} className="accent-primary" /> Enable
            </label>
          }
        />
        {customOn && (
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-tiny text-foreground/55">Weighting variables (◆ = derived demographic; others are survey columns)</span>
              <div className="flex flex-wrap gap-1.5">
                {vars.map((v) => {
                  const on = picked.includes(v.key)
                  return (
                    <button
                      key={v.key}
                      onClick={() => toggleVar(v.key)}
                      title={v.key}
                      className={`h-7 max-w-[220px] truncate rounded-full border px-2.5 text-tiny font-medium transition-colors ${
                        on ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-foreground/15 text-foreground/55 hover:bg-foreground/5"
                      }`}
                    >
                      {v.isDemo ? "◆ " : ""}
                      {v.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {picked.map((key) => {
              const v = varByKey.get(key)
              if (!v) return null
              const sum = sumOf(key)
              const balanced = Math.abs(sum - 100) < 0.5
              return (
                <div key={key} className="rounded-lg border border-foreground/10 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-small font-medium" title={v.key}>{v.label}</span>
                    <span className={`shrink-0 font-mono text-tiny ${balanced ? "text-primary" : "text-amber-600 dark:text-amber-400"}`}>sum {sum.toFixed(1)}%</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {v.categories.map((c) => (
                      <label key={c.value} className="flex items-center gap-2 text-tiny">
                        <span className="min-w-0 flex-1 truncate text-foreground/70" title={c.value}>{c.label}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={targets[key]?.[c.value] ?? ""}
                          onChange={(e) => setCell(key, c.value, e.target.value)}
                          className="h-7 w-16 rounded border border-foreground/15 bg-background px-1.5 text-right font-mono outline-none focus:border-primary/50"
                        />
                        <span className="text-foreground/40">%</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={applyCustom}
                disabled={!picked.length}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                <SlidersHorizontal size={14} /> Apply custom weighting
              </button>
              <button onClick={clearCustom} className="inline-flex h-9 items-center rounded-md border border-foreground/15 px-3 text-small font-medium text-foreground/70 hover:bg-foreground/5">
                Reset to weighting set
              </button>
              <span className="text-tiny text-foreground/45">Targets are normalized automatically; LV applies the same targets with turnout weighting.</span>
            </div>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Diagnostics" hint="DEFF, effective N, margin of error, and covariate balance (SMD < 0.10) per universe" />
        <CardBody className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <DiagColumn title="Registered voters" d={payload.rv.diagnostics} />
          <DiagColumn title="Likely voters" d={payload.lvUniverse.diagnostics} accent />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {([["Registered voters", payload.rv], ["Likely voters", payload.lvUniverse]] as const).map(([title, u]) => (
          <Card key={title}>
            <CardHeader title={`${title} — convergence`} hint="Iterative raking to convergence (uncapped; 99th-pct trim in calibration)" />
            <CardBody className="flex flex-col gap-2">
              <table className="w-full text-tiny">
                <thead>
                  <tr className="text-foreground/45">
                    <th className="text-left font-medium">Round</th>
                    <th className="text-right font-medium">Max deviation</th>
                    <th className="text-right font-medium">DEFF</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {u.rakeLog.rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="text-foreground/70">{r.round}</td>
                      <td className="text-right text-foreground/70">{(r.maxDeviation * 100).toFixed(3)}%</td>
                      <td className="text-right text-foreground/70">{r.deff.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {u.rakeLog.collapses.length > 0 && (
                <div className="text-tiny text-foreground/50">Collapsed: {u.rakeLog.collapses.join("; ")}</div>
              )}
              <div className="mt-1 flex flex-col gap-1 border-t border-foreground/[0.06] pt-2">
                {u.recall.map((s, i) => (
                  <div key={i} className="text-tiny text-foreground/60">
                    <span className="font-medium text-foreground/75">{s.stage}.</span> {s.note}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {Object.keys(payload.socal.rv).length > 0 && (
      <Card>
        <CardHeader
          title="SOCAL target derivation (RV)"
          hint="70/30 prior/observed blend, fired only when divergence exceeds 3pp"
          action={
            <select value={socalDim} onChange={(e) => setSocalDim(e.target.value)} className="h-8 rounded-md border border-foreground/15 bg-background px-2 text-tiny outline-none focus:border-primary/50">
              {Object.keys(payload.socal.rv).map((d) => (
                <option key={d} value={d}>
                  {DIM_LABEL[d] || d}
                </option>
              ))}
            </select>
          }
        />
        <CardBody>
          <table className="w-full text-tiny">
            <thead>
              <tr className="text-foreground/45">
                <th className="text-left font-medium">Cell</th>
                <th className="text-right font-medium">Prior</th>
                <th className="text-right font-medium">Observed</th>
                <th className="text-right font-medium">Final</th>
                <th className="text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((c) => (
                <tr key={c.cell} className="border-t border-foreground/[0.05]">
                  <td className="py-1 text-foreground/75">{c.cell}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-foreground/60">{c.prior.toFixed(1)}%</td>
                  <td className="py-1 text-right font-mono tabular-nums text-foreground/60">{c.observed.toFixed(1)}%</td>
                  <td className="py-1 text-right font-mono tabular-nums font-semibold text-foreground/80">{c.final.toFixed(1)}%</td>
                  <td className="py-1 text-right">{c.updated ? <span className="text-primary">●</span> : <span className="text-foreground/25">○</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      )}
    </div>
  )
}
