"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { fetchCrosstab, type ClientPayload, type RunConfig } from "@/lib/client-api"
import type { Crosstab } from "@/lib/types"

function CrosstabTable({ ct, label }: { ct: Crosstab; label?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-foreground/10">
      {label && <div className="border-b border-foreground/10 bg-foreground/[0.02] px-3 py-1.5 text-tiny font-semibold uppercase tracking-wider text-foreground/55">{label}</div>}
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-foreground/10 bg-foreground/[0.015] text-tiny font-medium uppercase tracking-wider text-foreground/55">
            <th className="px-3 py-2 text-left">Option</th>
            {ct.columns.map((c, i) => (
              <th key={c} className="px-3 py-2 text-right">
                {c}
                <div className="font-mono text-[10px] text-foreground/45">n={Math.round(ct.columnTotals[i] || 0)}</div>
              </th>
            ))}
            <th className="px-3 py-2 text-right">All</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/[0.06]">
          {ct.rows.map((r) => (
            <tr key={r.label} className="hover:bg-foreground/[0.02]">
              <td className="max-w-[220px] truncate px-3 py-2 text-foreground/80">{r.label}</td>
              {r.cells.map((c) => (
                <td
                  key={c.col}
                  className={`px-3 py-2 text-right font-mono tabular-nums ${c.significant ? "font-semibold text-primary" : "text-foreground/75"}`}
                  title={c.significant ? `±${c.moe.toFixed(1)}% MoE` : undefined}
                >
                  {c.pct.toFixed(0)}%
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/55">{r.all.pct.toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CrosstabPanel({ payload, csvText, name, config }: { payload: ClientPayload; csvText: string; name: string; config: RunConfig }) {
  const crosstabbable = payload.toplines.filter((t) => t.type !== "numeric" && t.type !== "open_ended").map((t) => t.key)
  const [questionKey, setQuestionKey] = useState(crosstabbable[0] || "")
  const [bannerKey, setBannerKey] = useState(payload.bannerDims[0]?.key || "")
  const [universe, setUniverse] = useState<"RV" | "LV" | "both">("RV")
  const [data, setData] = useState<{ crosstab?: Crosstab; rv?: Crosstab; lv?: Crosstab } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  const banner = useMemo(() => payload.bannerDims.find((b) => b.key === bannerKey), [payload.bannerDims, bannerKey])

  useEffect(() => {
    if (!questionKey || !banner) return
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    fetchCrosstab({ csvText, name, ...config, questionKey, banner, universe })
      .then((d) => id === reqId.current && setData(d))
      .catch((e) => id === reqId.current && setError(e.message))
      .finally(() => id === reqId.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey, bannerKey, universe])

  return (
    <Card>
      <CardHeader title="Crosstab builder" hint="Banner × stub with 95%-CI significance flagging in either universe" />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-small">
          <select value={questionKey} onChange={(e) => setQuestionKey(e.target.value)} title="The survey question to break down" className="h-9 max-w-[300px] truncate rounded-md border border-foreground/15 bg-background px-2 text-small outline-none focus:border-primary/50">
            {crosstabbable.map((k) => (
              <option key={k} value={k}>
                {k.length > 48 ? k.slice(0, 47) + "…" : k}
              </option>
            ))}
          </select>
          <span className="text-foreground/50">by</span>
          <select value={bannerKey} onChange={(e) => setBannerKey(e.target.value)} title="The demographic (or another question) to break the results down by" className="h-9 max-w-[220px] truncate rounded-md border border-foreground/15 bg-background px-2 text-small outline-none focus:border-primary/50">
            {payload.bannerDims.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/[0.02] p-0.5" title="Show the crosstab for Registered Voters, Likely Voters, or both side by side.">
            {(["RV", "LV", "both"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUniverse(u)}
                title={u === "RV" ? "Registered Voters" : u === "LV" ? "Likely Voters" : "Both universes"}
                className={`h-7 rounded px-2.5 text-tiny font-medium ${universe === u ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"}`}
              >
                {u === "both" ? "Both" : u}
              </button>
            ))}
          </div>
        </div>

        <div className="text-tiny text-foreground/45">Bold cells diverge from the row average beyond the 95% confidence interval.</div>

        {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-tiny text-rose-700 dark:text-rose-300">{error}</div>}
        {loading && (
          <div className="flex items-center gap-2 py-6 text-small text-foreground/55">
            <Loader2 size={14} className="animate-spin text-primary" /> Building crosstab…
          </div>
        )}

        {!loading && data && (
          <div className="flex flex-col gap-3">
            {data.crosstab && <CrosstabTable ct={data.crosstab} />}
            {data.rv && <CrosstabTable ct={data.rv} label="Registered voters" />}
            {data.lv && <CrosstabTable ct={data.lv} label="Likely voters" />}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
