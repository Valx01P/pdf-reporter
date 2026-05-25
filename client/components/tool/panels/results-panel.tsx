"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, Loader2 } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { DualQuestionCard } from "../question-card"
import { fetchUncertainty, type ClientPayload, type RunConfig, type UncertaintyResult } from "@/lib/client-api"

export function ResultsPanel({ payload, csvText, name, config }: { payload: ClientPayload; csvText: string; name: string; config: RunConfig }) {
  const recall = payload.shift.find((s) => s.dimension === "recall2024")
  const [unc, setUnc] = useState<UncertaintyResult | null>(null)
  const [uncLoading, setUncLoading] = useState(true)
  const [uncErr, setUncErr] = useState<string | null>(null)
  const reqId = useRef(0)

  // Auto-run the uncertainty analysis when results open or the run changes.
  const cfgKey = JSON.stringify(config)
  useEffect(() => {
    const id = ++reqId.current
    setUncLoading(true)
    setUncErr(null)
    fetchUncertainty({ csvText, name, ...config })
      .then((d) => id === reqId.current && setUnc(d.uncertainty))
      .catch((e) => id === reqId.current && setUncErr(e.message))
      .finally(() => id === reqId.current && setUncLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText, cfgKey])

  // No Monte-Carlo scenarios ⇒ custom weighting (band comes from the bootstrap SE).
  const customUnc = !!unc && unc.scenarios.length === 0

  return (
    <div className="flex flex-col gap-4">
      {recall && (
        <Card>
          <CardHeader title="RV → LV shift" hint="How the likely-voter screen reshapes the 2024-recall composition" />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-small">
                <thead>
                  <tr className="text-tiny uppercase tracking-wider text-foreground/45">
                    <th className="pb-2 text-left font-medium">2024 recall</th>
                    <th className="pb-2 text-right font-medium">Registered</th>
                    <th className="pb-2 text-right font-medium">After P(vote)</th>
                    <th className="pb-2 text-right font-medium text-primary">Likely</th>
                    <th className="pb-2 text-right font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {recall.rows.map((r) => {
                    const net = r.lv - r.rv
                    return (
                      <tr key={r.cell} className="border-t border-foreground/[0.06]">
                        <td className="py-1.5 text-foreground/80">{r.cell}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-foreground/65">{r.rv.toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-foreground/50">{r.pvote.toFixed(1)}%</td>
                        <td className="py-1.5 text-right font-mono tabular-nums font-semibold text-primary">{r.lv.toFixed(1)}%</td>
                        <td className={`py-1.5 text-right font-mono tabular-nums ${net > 0 ? "text-primary" : "text-foreground/55"}`}>
                          {net > 0 ? "+" : ""}
                          {net.toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Likely-voter uncertainty"
          hint={customUnc ? "Bootstrap standard errors + 90% band — turnout Monte-Carlo scenarios don't apply under custom weighting" : "9-scenario Monte Carlo envelope (3 turnouts × 3 target sets) + bootstrap standard errors"}
          action={uncLoading ? <Loader2 size={14} className="animate-spin text-primary" /> : <Activity size={14} className="text-foreground/40" />}
        />
        <CardBody>
          {uncErr && <div className="text-tiny text-rose-600 dark:text-rose-300">{uncErr}</div>}
          {uncLoading && !unc && <div className="text-small text-foreground/55">Running 9 Monte Carlo scenarios and bootstrap resamples…</div>}
          {unc && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 text-tiny text-foreground/55">
                <span className="rounded-md bg-foreground/[0.04] px-2 py-1">Envelope ±{unc.envelopePp} pp</span>
                {customUnc ? (
                  <span className="rounded-md bg-foreground/[0.04] px-2 py-1">custom weighting</span>
                ) : (
                  <span className="rounded-md bg-foreground/[0.04] px-2 py-1">{unc.scenarios.length} scenarios</span>
                )}
                <span className="rounded-md bg-foreground/[0.04] px-2 py-1">{unc.bootstrapB} bootstrap resamples</span>
                {!customUnc && (
                  <span className="rounded-md bg-foreground/[0.04] px-2 py-1">
                    turnout {[...new Set(unc.scenarios.map((s) => Math.round(s.meanPvote * 100)))].sort((a, b) => a - b).join(" / ")}%
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {unc.questions.map((q) => (
                  <div key={q.key}>
                    <h4 className="mb-1.5 truncate text-tiny font-semibold text-foreground/70">{q.prompt}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[440px] text-tiny">
                        <thead>
                          <tr className="text-foreground/45">
                            <th className="text-left font-medium">Option</th>
                            <th className="text-right font-medium">RV % ± SE</th>
                            <th className="text-right font-medium text-primary">LV % ± SE</th>
                            <th className="text-right font-medium">{customUnc ? "90% band (LV)" : "90% MC range (LV)"}</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono tabular-nums">
                          {q.options.map((o) => (
                            <tr key={o.label} className="border-t border-foreground/[0.05]">
                              <td className="py-1 font-sans text-foreground/75">{o.label}</td>
                              <td className="py-1 text-right text-foreground/65">{o.rv.toFixed(1)} ± {o.rvSe.toFixed(1)}</td>
                              <td className="py-1 text-right font-semibold text-primary">{o.lv.toFixed(1)} ± {o.lvSe.toFixed(1)}</td>
                              <td className="py-1 text-right text-foreground/55">{o.lvLow.toFixed(1)}–{o.lvHigh.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-4">
        {payload.toplines.map((t, i) => (
          <DualQuestionCard key={t.key} topline={t} index={i} />
        ))}
      </div>
    </div>
  )
}
