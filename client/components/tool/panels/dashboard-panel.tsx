"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, BarChart3, Gauge, Loader2, Target, TrendingUp, Users } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import { fetchCrosstab, type ClientPayload, type RunConfig } from "@/lib/client-api"
import type { Crosstab } from "@/lib/types"
import {
  ballotCandidates,
  detectBallotKey,
  fmtPct,
  fmtSigned,
  summarizeBallot,
  type BallotSummary,
} from "@/lib/dashboard"

type Universe = "RV" | "LV"

export function DashboardPanel({
  payload,
  csvText,
  name,
  config,
}: {
  payload: ClientPayload
  csvText: string
  name: string
  config: RunConfig
}) {
  const candidates = useMemo(() => ballotCandidates(payload.toplines), [payload.toplines])
  const autoKey = useMemo(() => detectBallotKey(payload.toplines), [payload.toplines])
  const fallbackKey = autoKey ?? candidates[0]?.key ?? payload.toplines[0]?.key ?? ""

  const [ballotKey, setBallotKey] = useState(fallbackKey)
  const [universe, setUniverse] = useState<Universe>("LV")

  // Re-anchor the selection when a new dataset loads (key list changes).
  const keysSig = candidates.map((c) => c.key).join("|")
  useEffect(() => {
    setBallotKey(fallbackKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig])

  const question = useMemo(
    () => payload.toplines.find((t) => t.key === ballotKey) ?? payload.toplines[0],
    [payload.toplines, ballotKey],
  )

  const summary: BallotSummary | null = useMemo(() => {
    if (!question) return null
    const sel = universe === "LV" ? question.lv.options : question.rv.options
    const oth = universe === "LV" ? question.rv.options : question.lv.options
    if (!sel.length) return null
    return summarizeBallot(question, sel, oth)
  }, [question, universe])

  const diag = universe === "LV" ? payload.lvUniverse.diagnostics : payload.rv.diagnostics
  const otherU: Universe = universe === "LV" ? "RV" : "LV"

  if (!question || !summary) {
    return (
      <Card>
        <CardBody>
          <p className="text-small text-foreground/55">
            No tabulated questions available for this dataset.
          </p>
        </CardBody>
      </Card>
    )
  }

  const accent = summary.leader?.color ?? "#1d4ed8"
  const isAuto = autoKey === ballotKey

  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-2">
        <UniverseToggle universe={universe} onChange={setUniverse} />
        <label className="ml-auto flex items-center gap-2 text-tiny text-foreground/55">
          <span>Ballot question</span>
          <select
            value={ballotKey}
            onChange={(e) => setBallotKey(e.target.value)}
            className="max-w-[260px] truncate rounded-md border border-foreground/15 bg-background px-2 py-1.5 text-tiny text-foreground/80"
          >
            {candidates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.prompt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Flagship ── */}
      <Flagship
        title={name || payload.name}
        summary={summary}
        universe={universe}
        otherU={otherU}
        moe={diag.moe}
        keptN={payload.quality.kept}
        effectiveN={diag.effectiveN}
        accent={accent}
        isAuto={isAuto}
      />

      {/* ── Candidate tiles ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {summary.ranked.map((r) => (
          <div
            key={r.label}
            className="psi-shadow relative overflow-hidden rounded-xl border border-foreground/10 bg-surface px-3.5 py-3"
          >
            <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: r.color }} />
            <div className="truncate text-tiny font-semibold" style={{ color: r.color }} title={r.label}>
              {r.label}
            </div>
            <div className="mt-1 font-mono text-h3 font-bold tabular-nums" style={{ color: r.color }}>
              {r.pct.toFixed(1)}
              <span className="text-small text-foreground/40">%</span>
            </div>
            <DeltaChip delta={r.delta} otherU={otherU} />
          </div>
        ))}
      </div>

      {/* ── Diagnostics ── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <DiagTile icon={Users} label={`${universe} eff. n`} value={Math.round(diag.effectiveN).toLocaleString()} sub={`of ${payload.quality.kept.toLocaleString()} kept`} />
        <DiagTile icon={Target} label="Margin of error" value={`±${diag.moe}%`} sub="95% CI" />
        <DiagTile icon={Gauge} label="DEFF" value={diag.deff.toFixed(2)} sub={`Kish ${diag.kishDeff.toFixed(2)}`} />
        <DiagTile icon={TrendingUp} label="Turnout" value={`${(payload.lv.projectedTurnout * 100).toFixed(0)}%`} sub="projected LV" />
        <DiagTile icon={Activity} label="Mean P(vote)" value={payload.lv.model.meanPvote.toFixed(2)} sub="LV model" />
        <DiagTile icon={BarChart3} label="Margin shift" value={`${fmtSigned(summary.marginShift)}pp`} sub={`${otherU} → ${universe}`} />
      </div>

      {/* ── Ballot by demographic ── */}
      <BallotCrosstab
        payload={payload}
        csvText={csvText}
        name={name}
        config={config}
        questionKey={ballotKey}
        universe={universe}
        accent={accent}
      />
    </div>
  )
}

function Flagship({
  title,
  summary,
  universe,
  otherU,
  moe,
  keptN,
  effectiveN,
  accent,
  isAuto,
}: {
  title: string
  summary: BallotSummary
  universe: Universe
  otherU: Universe
  moe: number
  keptN: number
  effectiveN: number
  accent: string
  isAuto: boolean
}) {
  const { leader, second, margin, tied } = summary
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#070f2b] via-[#0f2a5e] to-[#1e3a8a] px-6 py-7 text-white shadow-lg">
      <div
        className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-20 blur-2xl"
        style={{ background: accent }}
      />
      <div className="absolute right-5 top-5 flex flex-col items-end gap-1">
        <span className="rounded border border-white/20 bg-white/10 px-2.5 py-1 font-mono text-tiny font-semibold tracking-wide">
          {universe === "LV" ? "LIKELY VOTERS" : "REGISTERED VOTERS"}
        </span>
        <span className="font-mono text-tiny text-white/45">eff. n={Math.round(effectiveN).toLocaleString()}</span>
      </div>

      <div className="font-mono text-tiny uppercase tracking-[0.14em] text-white/45">
        {isAuto ? "Ballot · auto-detected" : "Selected question"}
      </div>
      <div className="mt-1 max-w-[70%] truncate text-small text-white/70" title={summary.prompt}>
        {summary.prompt}
      </div>

      {leader ? (
        <>
          <div className="mt-4 flex items-end gap-3">
            <span className="font-mono text-[3.2rem] font-bold leading-none tracking-tight" style={{ color: "#93c5fd" }}>
              {leader.pct.toFixed(0)}
              <span className="text-3xl text-white/50">%</span>
            </span>
            <span className="mb-1.5 font-mono text-small text-white/80">{leader.label}</span>
          </div>
          <div className="mt-2 text-base font-medium text-white/85">
            {tied
              ? `Tied with ${second?.label} — within the margin`
              : second
                ? `${fmtSigned(margin)} pp over ${second.label}`
                : `Leading the field`}
          </div>
        </>
      ) : (
        <div className="mt-4 text-base text-white/70">No candidate response to lead the field.</div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-tiny text-white/45">
        <span>{title}</span>
        <span>n={keptN.toLocaleString()}</span>
        <span>±{moe}% MoE</span>
        <span>
          margin shift {fmtSigned(summary.marginShift)} pp ({otherU}→{universe})
        </span>
      </div>
    </div>
  )
}

function UniverseToggle({ universe, onChange }: { universe: Universe; onChange: (u: Universe) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-foreground/10 bg-foreground/[0.02] p-0.5" title="Registered Voters or Likely Voters">
      {(["RV", "LV"] as const).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          title={u === "RV" ? "Registered Voters" : "Likely Voters"}
          className={`h-7 rounded px-3 text-tiny font-medium ${
            universe === u ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  )
}

function DeltaChip({ delta, otherU }: { delta: number; otherU: Universe }) {
  const neutral = Math.abs(delta) < 0.05
  const cls = neutral
    ? "bg-foreground/[0.05] text-foreground/45"
    : delta > 0
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
  return (
    <span
      className={`mt-1.5 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
      title={`Change vs ${otherU}`}
    >
      {neutral ? "±0.0" : fmtSigned(delta)} pp
    </span>
  )
}

function DiagTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Users
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="psi-shadow rounded-lg border border-foreground/10 bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <Icon size={11} className="text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/45">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-base font-bold tabular-nums">{value}</div>
      <div className="font-mono text-[10px] text-foreground/40">{sub}</div>
    </div>
  )
}

function BallotCrosstab({
  payload,
  csvText,
  name,
  config,
  questionKey,
  universe,
  accent,
}: {
  payload: ClientPayload
  csvText: string
  name: string
  config: RunConfig
  questionKey: string
  universe: Universe
  accent: string
}) {
  const demoBanners = useMemo(() => payload.bannerDims.filter((b) => b.isDemo), [payload.bannerDims])
  const [bannerKey, setBannerKey] = useState(demoBanners[0]?.key ?? "")
  const [data, setData] = useState<Crosstab | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (demoBanners.length && !demoBanners.some((b) => b.key === bannerKey)) setBannerKey(demoBanners[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.bannerDims])

  const banner = demoBanners.find((b) => b.key === bannerKey)
  const cfgKey = JSON.stringify(config)
  useEffect(() => {
    if (!banner || !questionKey) {
      setData(null)
      return
    }
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    fetchCrosstab({ csvText, name, ...config, questionKey, banner, universe })
      .then((d) => id === reqId.current && setData(d.crosstab ?? null))
      .catch((e) => id === reqId.current && setError(e.message))
      .finally(() => id === reqId.current && setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionKey, bannerKey, universe, cfgKey])

  if (!demoBanners.length) return null

  return (
    <Card>
      <CardHeader
        title="Ballot by demographic"
        hint={`Column-% within each ${banner?.label ?? ""} group · ${universe}`}
        action={
          <select
            value={bannerKey}
            onChange={(e) => setBannerKey(e.target.value)}
            className="rounded-md border border-foreground/15 bg-background px-2 py-1 text-tiny text-foreground/80"
          >
            {demoBanners.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
        }
      />
      <CardBody>
        {error && <div className="text-tiny text-rose-600 dark:text-rose-300">{error}</div>}
        {loading && (
          <div className="flex items-center gap-2 py-6 text-small text-foreground/55">
            <Loader2 size={14} className="animate-spin text-primary" /> Building crosstab…
          </div>
        )}
        {!loading && data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-tiny">
              <thead>
                <tr className="text-foreground/45">
                  <th className="px-2.5 py-1.5 text-left font-medium">Response</th>
                  <th className="px-2.5 py-1.5 text-right font-semibold text-foreground/60">Total</th>
                  {data.columns.map((c, i) => (
                    <th key={c} className="px-2.5 py-1.5 text-right font-medium" title={`n=${Math.round(data.columnTotals[i])}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {data.rows.map((r) => (
                  <tr key={r.label} className="border-t border-foreground/[0.06] hover:bg-foreground/[0.02]">
                    <td className="px-2.5 py-1.5 text-left font-sans text-foreground/80" title={r.label}>
                      {r.label}
                    </td>
                    <td className="bg-foreground/[0.03] px-2.5 py-1.5 text-right font-semibold text-foreground/85">
                      {r.all.pct.toFixed(1)}%
                    </td>
                    {r.cells.map((cell, i) => (
                      <td
                        key={i}
                        className={`px-2.5 py-1.5 text-right ${cell.significant ? "font-semibold" : "text-foreground/65"}`}
                        style={cell.significant ? { color: accent } : undefined}
                      >
                        {cell.pct.toFixed(1)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-foreground/40">
              Colored cells diverge from the Total beyond the 95% confidence interval.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
