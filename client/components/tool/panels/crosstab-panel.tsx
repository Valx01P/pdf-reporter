"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { fetchExportFile, fetchTabbook, type ClientPayload, type RunConfig } from "@/lib/client-api"
import { ExportConfirmButton } from "../export-confirm"
import { formatSummaryValue } from "@/lib/tabbook-format"
import type { Tabbook } from "@/lib/types"

// One wide Tabbook grid: response labels + Total sticky on the left, every banner
// group to the right. The grouped header, column header and (unweighted n) row
// are shared (sticky); each question is a labelled block of response rows.
function TabbookGrid({ tb }: { tb: Tabbook }) {
  // column index → whether it starts a new banner group (for vertical dividers)
  const groupStart = useMemo(() => {
    const starts = new Set<number>()
    let c = 0
    for (const g of tb.groups) {
      starts.add(c)
      c += g.span
    }
    return starts
  }, [tb.groups])

  const labelCls = "sticky left-0 z-10 bg-background px-2.5 py-1.5 text-left"
  const cellBorder = (i: number) => (groupStart.has(i) && i !== 0 ? "border-l border-foreground/15" : "")
  // Opaque equivalent of a translucent foreground tint over the page background.
  // Sticky cells need a solid fill, or columns scrolled underneath bleed through
  // them and the text overlaps (e.g. "Total" showing through "Response").
  const tint = (pct: number) => `color-mix(in srgb, var(--foreground) ${pct}%, var(--background))`

  return (
    <div className="max-w-full overflow-auto rounded-lg border border-foreground/10" style={{ maxHeight: "75dvh" }}>
      <table className="w-max border-collapse text-tiny">
        <thead>
          {/* grouped banner header */}
          <tr className="sticky top-0 z-20" style={{ background: tint(4) }}>
            <th className={`${labelCls} z-30 align-bottom font-semibold text-foreground/70`} style={{ background: tint(4) }}>Response</th>
            {tb.groups.map((g, gi) => (
              <th
                key={`${g.label}-${gi}`}
                colSpan={g.span}
                className={`whitespace-nowrap px-2.5 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-foreground/60 ${gi !== 0 ? "border-l border-foreground/15" : ""}`}
              >
                {g.label}
              </th>
            ))}
          </tr>
          {/* column labels */}
          <tr className="sticky top-[29px] z-20" style={{ background: tint(2) }}>
            <th className={`${labelCls} z-30`} style={{ background: tint(2) }} />
            {tb.columns.map((c, i) => (
              <th
                key={`${c.groupKey}-${c.value}-${i}`}
                className={`max-w-[120px] whitespace-nowrap px-2.5 py-1.5 text-right align-bottom font-medium text-foreground/70 ${c.isTotal ? "font-semibold" : ""} ${cellBorder(i)}`}
                title={c.label}
              >
                {c.label}
              </th>
            ))}
          </tr>
          {/* unweighted n */}
          <tr className="sticky top-[58px] z-20 border-b border-foreground/15 bg-background text-foreground/45">
            <th className={`${labelCls} text-[10px] font-normal`}>(unweighted n)</th>
            {tb.columns.map((c, i) => (
              <td key={`n-${i}`} className={`px-2.5 py-1 text-right font-mono text-[10px] ${cellBorder(i)}`}>
                {c.isTotal ? "" : c.unweightedN}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {tb.questions.map((q) => (
            <Fragment key={q.key}>
              <tr className="border-t border-foreground/10" style={{ background: tint(2.5) }}>
                <td colSpan={tb.columns.length + 1} className="p-0">
                  {/* Inner sticky element: the full-width <td> gives sticky no room
                      to pin, so the text would scroll off; a bounded child pins it. */}
                  <div
                    className="sticky left-0 z-10 block w-fit max-w-[680px] truncate px-2.5 py-1.5 text-small font-semibold text-foreground/85"
                    style={{ background: tint(2.5) }}
                    title={q.prompt}
                  >
                    {q.prompt}
                  </div>
                </td>
              </tr>
              {q.rows.length === 0 ? (
                <tr>
                  <td colSpan={tb.columns.length + 1} className="sticky left-0 bg-background px-2.5 py-1.5 text-tiny italic text-foreground/50">
                    {q.note}
                  </td>
                </tr>
              ) : (
                q.rows.map((r) => (
                  <tr key={`${q.key}-${r.label}`} className="border-t border-foreground/[0.06] hover:bg-foreground/[0.02]">
                    <td className={`${labelCls} max-w-[280px] truncate text-foreground/80`} title={r.label}>
                      {r.label}
                    </td>
                    {r.pct.map((p, i) => (
                      <td
                        key={i}
                        className={`px-2.5 py-1 text-right font-mono tabular-nums ${cellBorder(i)} ${
                          tb.columns[i].isTotal
                            ? "bg-primary/[0.05] font-semibold text-foreground/90"
                            : r.significant[i]
                              ? "font-semibold text-primary"
                              : "text-foreground/65"
                        }`}
                      >
                        {q.valueFormat === "rank" ? p.toFixed(2) : `${p.toFixed(1)}%`}
                      </td>
                    ))}
                  </tr>
                ))
              )}
              {q.summary?.map((s) => (
                <tr key={`${q.key}-sum-${s.label}`} className={`border-t border-foreground/15 ${s.emphasis ? "font-semibold" : ""}`}>
                  <td className={`${labelCls} max-w-[280px] truncate ${s.emphasis ? "text-foreground/90" : "text-foreground/65"}`} title={s.label}>
                    {s.label}
                  </td>
                  {s.values.map((v, i) => (
                    <td
                      key={i}
                      className={`px-2.5 py-1 text-right font-mono tabular-nums ${cellBorder(i)} ${
                        tb.columns[i].isTotal ? "bg-primary/[0.05] font-semibold text-foreground/90" : s.emphasis ? "text-foreground/85" : "text-foreground/65"
                      }`}
                    >
                      {formatSummaryValue(v, s.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CrosstabPanel({ payload, csvText, name, config }: { payload: ClientPayload; csvText: string; name: string; config: RunConfig }) {
  const demoDims = payload.tabbookDims
  const questionBanners = payload.bannerDims.filter((b) => !b.isDemo)

  const [universe, setUniverse] = useState<"RV" | "LV">("RV")
  const [demoOn, setDemoOn] = useState<Set<string>>(() => new Set(demoDims.map((d) => d.key)))
  const [qOn, setQOn] = useState<Set<string>>(() => new Set())
  const [data, setData] = useState<{ rv?: Tabbook; lv?: Tabbook } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  const banners = useMemo(
    () => [
      ...demoDims.filter((d) => demoOn.has(d.key)).map((d) => ({ key: d.key, isDemo: true })),
      ...questionBanners.filter((b) => qOn.has(b.key)).map((b) => ({ key: b.key, isDemo: false })),
    ],
    [demoDims, demoOn, questionBanners, qOn],
  )
  const bannersKey = JSON.stringify(banners)

  useEffect(() => {
    if (!banners.length) {
      setData(null)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    fetchTabbook({ csvText, name, ...config, universe: "both", banners })
      .then((d) => id === reqId.current && setData({ rv: d.rv, lv: d.lv }))
      .catch((e) => id === reqId.current && setError(e.message))
      .finally(() => id === reqId.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannersKey])

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const tb = universe === "RV" ? data?.rv : data?.lv

  return (
    <Card>
      <CardHeader
        title="Tabbook"
        hint="Every question's Total on the left, all crosstab banners to the right — one universe at a time"
        action={
          <ExportConfirmButton
            variant="compact"
            label={`${universe} CSV`}
            icon={Download}
            title={`Preview the ${universe} tabbook CSV, then confirm to download`}
            disabled={!tb}
            fetchFile={() => fetchExportFile({ csvText, name, ...config, format: universe === "RV" ? "tabbook-rv" : "tabbook-lv", banners })}
          />
        }
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-small">
          <div className="flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/[0.02] p-0.5" title="Registered Voters or Likely Voters">
            {(["RV", "LV"] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUniverse(u)}
                title={u === "RV" ? "Registered Voters" : "Likely Voters"}
                className={`h-7 rounded px-3 text-tiny font-medium ${universe === u ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"}`}
              >
                {u}
              </button>
            ))}
          </div>
          <span className="text-tiny text-foreground/45">Banner columns:</span>
          {demoDims.map((d) => {
            const on = demoOn.has(d.key)
            return (
              <button
                key={d.key}
                onClick={() => toggle(demoOn, d.key, setDemoOn)}
                className={`h-7 rounded-full border px-2.5 text-tiny font-medium transition-colors ${
                  on ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-foreground/15 text-foreground/55 hover:bg-foreground/5"
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>

        {questionBanners.length > 0 && (
          <details className="rounded-md border border-foreground/10 bg-foreground/[0.015] px-3 py-2">
            <summary className="cursor-pointer select-none text-tiny font-medium text-foreground/60">
              Add survey questions as banner columns ({qOn.size} on)
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {questionBanners.map((b) => {
                const on = qOn.has(b.key)
                return (
                  <button
                    key={b.key}
                    onClick={() => toggle(qOn, b.key, setQOn)}
                    title={b.key}
                    className={`h-7 max-w-[220px] truncate rounded-full border px-2.5 text-tiny font-medium transition-colors ${
                      on ? "border-primary/30 bg-primary/[0.08] text-primary" : "border-foreground/15 text-foreground/55 hover:bg-foreground/5"
                    }`}
                  >
                    {b.label}
                  </button>
                )
              })}
            </div>
          </details>
        )}

        <div className="text-tiny text-foreground/45">
          Each cell is the column-% within that group. <span className="font-semibold text-primary">Bold colored</span> cells diverge from the Total beyond the 95% confidence interval. The Total column is shaded.
        </div>

        {error && <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-tiny text-rose-700 dark:text-rose-300">{error}</div>}
        {loading && (
          <div className="flex items-center gap-2 py-6 text-small text-foreground/55">
            <Loader2 size={14} className="animate-spin text-primary" /> Building tabbook…
          </div>
        )}
        {!loading && !banners.length && <div className="py-6 text-small text-foreground/55">Select at least one banner column.</div>}
        {!loading && tb && <TabbookGrid tb={tb} />}
      </CardBody>
    </Card>
  )
}
