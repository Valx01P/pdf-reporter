"use client"

import { useState } from "react"
import { CheckCircle2, CircleAlert } from "lucide-react"
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Weighting set" hint="Set B (41 cells) is preferred for Pathway 3; Set A (33 cells) is fully specified" />
        <CardBody className="flex flex-wrap gap-2">
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
                onClick={() => onApply({ weightingSet: s })}
                className={`inline-flex h-9 items-center rounded-md border px-4 text-small font-medium ${
                  active ? "border-primary/40 bg-primary/[0.08] text-primary" : "border-foreground/15 text-foreground/70 hover:bg-foreground/5"
                }`}
              >
                Set {s}
              </button>
            )
          })}
        </CardBody>
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
            <CardHeader title={`${title} — convergence`} hint="4-round capped raking (Phase 3a/3b)" />
            <CardBody className="flex flex-col gap-2">
              <table className="w-full text-tiny">
                <thead>
                  <tr className="text-foreground/45">
                    <th className="text-left font-medium">Round</th>
                    <th className="text-right font-medium">Max deviation</th>
                    <th className="text-right font-medium">DEFF</th>
                    <th className="text-right font-medium">Cap</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {u.rakeLog.rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="text-foreground/70">{r.round}</td>
                      <td className="text-right text-foreground/70">{(r.maxDeviation * 100).toFixed(3)}%</td>
                      <td className="text-right text-foreground/70">{r.deff.toFixed(2)}</td>
                      <td className="text-right text-foreground/55">{r.cap ?? "—"}</td>
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
    </div>
  )
}
