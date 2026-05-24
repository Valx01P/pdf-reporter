"use client"

import { useState } from "react"
import { Sliders } from "lucide-react"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import type { ClientPayload, RunConfig } from "@/lib/client-api"

function MiniHist({ bins, color = "var(--primary)" }: { bins: { label: string; count: number }[]; color?: string }) {
  const max = Math.max(1, ...bins.map((b) => b.count))
  return (
    <div className="flex h-24 items-end gap-1">
      {bins.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1" title={`${b.label}: ${b.count}`}>
          <div className="w-full rounded-t" style={{ height: `${(b.count / max) * 100}%`, background: color, minHeight: 1 }} />
          <span className="text-[9px] text-foreground/40">{b.label.split("–")[0]}</span>
        </div>
      ))}
    </div>
  )
}

export function LvPanel({ payload, onApply }: { payload: ClientPayload; onApply: (p: Partial<RunConfig>) => void }) {
  const lv = payload.lv
  const [turnout, setTurnout] = useState(Math.round(lv.projectedTurnout * 1000) / 10)
  const [k, setK] = useState(lv.k)
  const [maps, setMaps] = useState({ q3: lv.q3Map, q4: lv.q4Map, q5: lv.q5Map })

  const total = lv.model.buckets.consistent + lv.model.buckets.occasional + lv.model.buckets.new || 1

  const applyTurnout = () => onApply({ k, voters: Math.round((turnout / 100) * lv.registered) })
  const applyMaps = () => onApply({ q3Map: maps.q3, q4Map: maps.q4, q5Map: maps.q5 })

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Likely-voter calibration" hint="Geometric mean of Q3/Q4/Q5 → logistic P(vote), midpoint µ solved to the projected turnout" />
        <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Logistic midpoint µ", lv.model.mu.toFixed(3)],
            ["Mean P(vote)", lv.model.meanPvote.toFixed(3)],
            ["P(vote) ≥ 0.9", lv.model.highCount.toLocaleString()],
            ["P(vote) ≤ 0.1", lv.model.lowCount.toLocaleString()],
          ].map(([l, v]) => (
            <div key={l} className="rounded-md bg-foreground/[0.03] px-3 py-2.5">
              <div className="text-tiny text-foreground/50">{l}</div>
              <div className="font-mono text-h3 font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Raw LV score (geometric)" hint="Distribution of cube-root(Q3·Q4·Q5)" />
          <CardBody>
            <MiniHist bins={lv.model.rawHist} color="color-mix(in srgb, var(--foreground) 35%, transparent)" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Calibrated P(vote)" hint="After logistic calibration to projected turnout" />
          <CardBody>
            <MiniHist bins={lv.model.pvoteHist} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Q2 vote-history buckets" hint="Modulates logistic steepness k" />
        <CardBody className="flex flex-col gap-2">
          {([["consistent", "Consistent (3+ elections)"], ["occasional", "Occasional (1–2)"], ["new", "New / never voted"]] as const).map(([key, label]) => {
            const count = lv.model.buckets[key]
            return (
              <div key={key} className="grid grid-cols-[1fr_auto] items-center gap-3 text-tiny">
                <div className="flex items-center gap-2">
                  <span className="w-40 text-foreground/70">{label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                </div>
                <span className="tabular-nums text-foreground/55">
                  {count.toLocaleString()} · k={k[key]}
                </span>
              </div>
            )
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Calibration controls" hint="Phase 3b-1" action={<Sliders size={14} className="text-foreground/40" />} />
        <CardBody className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-tiny text-foreground/60">
              <span>Projected turnout</span>
              <span className="font-mono font-semibold text-foreground/80">{turnout.toFixed(1)}%</span>
            </span>
            <input
              type="range"
              min={40}
              max={90}
              step={0.5}
              value={turnout}
              onChange={(e) => setTurnout(Number(e.target.value))}
              title="The turnout the likely-voter model calibrates to. Higher turnout pulls more respondents into the likely electorate."
              className="accent-primary"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            {(["consistent", "occasional", "new"] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1" title={`Logistic steepness for ${key} voters. Higher k = a sharper cut between likely and unlikely voters in this vote-history group.`}>
                <span className="text-tiny capitalize text-foreground/60">k · {key}</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={k[key]}
                  onChange={(e) => setK((s) => ({ ...s, [key]: Number(e.target.value) }))}
                  className="h-9 rounded-md border border-foreground/15 bg-background px-2 text-small outline-none focus:border-primary/50"
                />
              </label>
            ))}
          </div>
          <button onClick={applyTurnout} title="Re-run the weighting with this turnout and k, and update the report." className="inline-flex h-9 w-fit items-center rounded-md bg-primary px-4 text-small font-medium text-white hover:opacity-90">
            Apply calibration
          </button>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {([["q3", "Q3 · Motivation"], ["q4", "Q4 · Preparedness"], ["q5", "Q5 · Social"]] as const).map(([qk, label]) => (
          <Card key={qk}>
            <CardHeader title={label} hint="Editable response weights [0–1]" />
            <CardBody className="flex flex-col gap-1.5">
              {Object.entries(maps[qk]).map(([resp, w]) => (
                <div key={resp} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <span className="truncate text-tiny text-foreground/70" title={resp}>
                    {resp}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.001}
                    value={w}
                    title="How much this answer counts toward voting (0 = won't vote, 1 = certain). The three questions combine into each respondent's turnout score."
                    onChange={(e) => setMaps((m) => ({ ...m, [qk]: { ...m[qk], [resp]: Number(e.target.value) } }))}
                    className="h-7 w-16 rounded border border-foreground/15 bg-background px-1.5 text-right font-mono text-tiny outline-none focus:border-primary/50"
                  />
                </div>
              ))}
            </CardBody>
          </Card>
        ))}
      </div>
      <button onClick={applyMaps} title="Re-run the weighting with these response weights, and update the report." className="inline-flex h-9 w-fit items-center rounded-md border border-primary/30 bg-primary/[0.06] px-4 text-small font-medium text-primary hover:bg-primary/10">
        Apply weight maps
      </button>
    </div>
  )
}
