"use client"

import { CheckCircle2, Filter } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import type { ClientPayload } from "@/lib/client-api"
import type { ColumnMapping } from "@/lib/psi/types"

const FIELD_LABELS: { key: keyof ColumnMapping; label: string }[] = [
  { key: "q2", label: "Vote history / frequency" },
  { key: "q3", label: "Q3 · Motivation" },
  { key: "q4", label: "Q4 · Preparedness" },
  { key: "q5", label: "Q5 · Social" },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex / Gender" },
  { key: "education", label: "Education" },
  { key: "race", label: "Race / ethnicity" },
  { key: "state", label: "State" },
  { key: "region", label: "Region" },
  { key: "income", label: "Income" },
  { key: "party", label: "Party ID" },
  { key: "recall2024", label: "Past-vote recall" },
]

export function DataPanel({
  payload,
  onMapping,
}: {
  payload: ClientPayload
  onMapping: (m: Partial<ColumnMapping>) => void
}) {
  const q = payload.quality
  const setField = (field: keyof ColumnMapping, value: string) => {
    const next: Partial<ColumnMapping> = { ...payload.mapping }
    if (value) next[field] = value
    else delete next[field]
    onMapping(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Quality screen" hint="Phase 1 — speeders and straightliners removed before any weighting" />
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Total responses", q.total],
            ["Speeders removed", q.speeders],
            ["Straightliners removed", q.straightliners],
            ["Kept for analysis", q.kept],
          ].map(([label, val]) => (
            <div key={label as string} className="rounded-md bg-foreground/[0.03] px-3 py-2.5">
              <div className="text-tiny text-foreground/50">{label}</div>
              <div className="font-mono text-h3 font-bold tabular-nums">{(val as number).toLocaleString()}</div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Column mapping" hint="Auto-detected by header + response-content matching. Reassign any field that's wrong." />
        <CardBody className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_LABELS.map(({ key, label }) => {
            const mapped = payload.mapping[key]
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-tiny font-medium text-foreground/60">
                  {mapped && <CheckCircle2 size={11} className="text-primary" />}
                  {label}
                </span>
                <select
                  value={mapped || ""}
                  onChange={(e) => setField(key, e.target.value)}
                  title={`Which CSV column holds "${label}". Auto-detected — change it only if it's wrong.`}
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
        <CardHeader title="Sample composition" hint="Unweighted sample vs the weighted RV and LV universes" />
        <CardBody className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          {payload.composition.map((c) => (
            <div key={c.key}>
              <h4 className="mb-2 flex items-center gap-1.5 text-tiny font-semibold uppercase tracking-wider text-foreground/50">
                <Filter size={11} className="text-primary" />
                {c.label}
              </h4>
              <div className="flex flex-col gap-1.5">
                {c.values.slice(0, 8).map((v) => (
                  <div key={v.value} className="grid grid-cols-[1fr_auto] items-center gap-2 text-tiny">
                    <span className="truncate text-foreground/75">{v.value}</span>
                    <span className="tabular-nums text-foreground/55">
                      <span className="text-foreground/45">{v.unweighted.toFixed(0)}%</span>
                      <span className="mx-1 text-foreground/25">·</span>
                      RV {v.rv.toFixed(0)}%
                      <span className="mx-1 text-foreground/25">·</span>
                      <span className="text-primary">LV {v.lv.toFixed(0)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}
