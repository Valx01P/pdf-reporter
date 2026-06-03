"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Check, CircleAlert, CircleCheck, Info, Loader2, Sparkles, TriangleAlert, X } from "lucide-react"
import { fetchMappingSuggestions, type ClientPayload, type MappingSuggestion, type RunConfig } from "@/lib/client-api"
import type { ColumnMapping } from "@/lib/psi/types"

// Important fields the reviewer treats as fixable, with a plain-language brief
// and an example of what a good column for that field looks like.
const FIELD_META: Record<string, { label: string; detail: string; severity: "error" | "warn"; example: string[] }> = {
  age: { label: "Age", detail: "Age (or age band) drives Age×Sex weighting and the turnout model.", severity: "error", example: ["18-29", "30-44", "45-64", "65+"] },
  sex: { label: "Sex / Gender", detail: "Used for Age×Sex and Education×Sex weighting.", severity: "error", example: ["Male", "Female"] },
  education: { label: "Education", detail: "College / no college — a core raking dimension.", severity: "error", example: ["College", "No College", "Bachelor's degree", "High school"] },
  race: { label: "Race / ethnicity", detail: "Used for Race×Education weighting.", severity: "error", example: ["White", "Black", "Hispanic", "Asian/Other"] },
  region: { label: "Region / state", detail: "Geography for regional weighting (a region column or a state column).", severity: "warn", example: ["Northeast", "Midwest", "South", "West"] },
  recall2024: { label: "Past-vote recall", detail: "Anchors partisan composition with a recalled prior vote (not the current ballot).", severity: "warn", example: ["Donald Trump", "Kamala Harris", "Did not vote"] },
  q3: { label: "Likely-voter screen — motivation", detail: "Feeds the turnout model — enthusiasm / motivation to vote.", severity: "warn", example: ["Very motivated", "Somewhat", "Not at all"] },
  q4: { label: "Likely-voter screen — turnout intent", detail: 'Feeds the turnout model — e.g. "How likely are you to vote".', severity: "warn", example: ["Already voted", "Certain", "Likely", "Unlikely"] },
  q5: { label: "Likely-voter screen — social", detail: "Feeds the turnout model — whether the people they know plan to vote.", severity: "warn", example: ["Most plan to vote", "About half", "A few", "None"] },
}
const FIX_ORDER = ["age", "sex", "education", "race", "region", "recall2024", "q3", "q4", "q5"] as const

type Issue =
  | { id: string; kind: "map"; field: string; label: string; detail: string; severity: "error" | "warn"; example: string[] }
  | { id: string; kind: "notice"; severity: "warn" | "info"; title: string; detail: string }

function noticeTitle(w: string): string {
  if (/left unweighted/i.test(w)) return "Dimension left unweighted"
  if (/Kept sample/i.test(w)) return "Small sample size"
  if (/Custom weighting is active/i.test(w)) return "Custom weighting active"
  if (/design effect/i.test(w)) return "High design effect"
  if (/coerced/i.test(w)) return "Responses coerced for raking"
  if (/Set B/i.test(w)) return "Set B joint dimension derived"
  return "Notice"
}

// Warnings already represented by a fixable map issue — don't double-list them.
const REDUNDANT = /Q3\/Q4\/Q5|likely-voter screen questions|recall column|demographic columns were detected|Map age, sex/i

// `ackNotices` is the durable signal that the one-click resolver acknowledged
// every disclosure. Notices are reworded/reordered when a mapping change re-runs
// the pipeline, so a text-keyed dismiss would let them resurface — this flag keeps
// them suppressed for the dataset. Map issues use stable `map:<field>` ids, so the
// per-issue `dismissed` set is enough for those.
function buildIssues(payload: ClientPayload, dismissed: Set<string>, ackNotices: boolean): Issue[] {
  const out: Issue[] = []
  for (const field of FIX_ORDER) {
    if (field === "region") {
      if (payload.mapping.region || payload.mapping.state) continue
    } else if (payload.mapping[field as keyof ColumnMapping]) continue
    const m = FIELD_META[field]
    out.push({ id: `map:${field}`, kind: "map", field, label: m.label, detail: m.detail, severity: m.severity, example: m.example })
  }
  for (const w of payload.warnings) {
    if (ackNotices || REDUNDANT.test(w)) continue
    const sev: "warn" | "info" = /unweighted|design effect|coerced|small/i.test(w) ? "warn" : "info"
    out.push({ id: `notice:${w.slice(0, 40)}`, kind: "notice", severity: sev, title: noticeTitle(w), detail: w })
  }
  return out.filter((i) => !dismissed.has(i.id))
}

export function IssuesReviewer({
  payload,
  csvText,
  name,
  config,
  onMapping,
}: {
  payload: ClientPayload
  csvText: string
  name: string
  config: RunConfig
  onMapping: (m: Partial<ColumnMapping>) => void
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [ackNotices, setAckNotices] = useState(false)
  const [selected, setSelected] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [suggestions, setSuggestions] = useState<Record<string, MappingSuggestion>>({})
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "off">("idle")
  // Summary of what the one-click resolver did, shown until the next edit.
  const [resolution, setResolution] = useState<{ applied: { field: string; column: string }[]; notInData: string[]; ack: number; critical: string[] } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // A new dataset starts clean. Keyed on csvText/name, NOT payload — payload is
  // replaced on every pipeline re-run (e.g. after applying a mapping), and those
  // must not wipe what the resolver just dismissed.
  useEffect(() => {
    setDismissed(new Set())
    setAckNotices(false)
    setResolution(null)
    setSuggestions({})
    setChosen({})
    setAiState("idle")
  }, [csvText, name])

  const issues = useMemo(() => buildIssues(payload, dismissed, ackNotices), [payload, dismissed, ackNotices])
  const mapIssues = issues.filter((i) => i.kind === "map")

  // Keep selection in range as issues resolve.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, issues.length - 1)))
  }, [issues.length])

  const dismiss = (id: string) => setDismissed((d) => new Set(d).add(id))

  const applyMap = (field: string, column: string) => {
    if (!column) return
    setResolution(null)
    onMapping({ ...payload.mapping, [field]: column })
    // The re-run drops this issue; advance toward the next one.
    setSelected((s) => Math.min(s, Math.max(0, issues.length - 2)))
  }

  // One click resolves the whole review: apply every confident column match,
  // mark genuinely-absent OPTIONAL inputs as "not in your data" (the pipeline
  // runs without them), and acknowledge the unfixable disclosures. Core
  // demographics that are truly missing are left flagged — never invented.
  //
  // The column-suggestion call is best-effort: if it fails (timeout / 5xx), we
  // STILL resolve everything else, so one click never leaves the whole list
  // standing. Notices are acknowledged durably via `ackNotices` so a pipeline
  // re-run (triggered by the mappings we just applied) can't resurface them.
  const runAi = async () => {
    if (!issues.length) return
    setAiState("loading")
    setResolution(null)

    // 1) Best-effort: get column suggestions for the unmapped fields. The route
    //    has a deterministic keyword fallback, so this returns matches even with
    //    no API key — but a hard failure here must not block step 2.
    const patch: Record<string, string> = {}
    let aiFailed = false
    if (mapIssues.length) {
      try {
        const { suggestions: sug } = await fetchMappingSuggestions({
          csvText,
          name,
          ...config,
          fields: mapIssues.map((i) => (i as Extract<Issue, { kind: "map" }>).field),
        })
        const byField: Record<string, MappingSuggestion> = {}
        for (const s of sug) {
          byField[s.field] = s
          if (s.column) patch[s.field] = s.column
        }
        setSuggestions(byField)
      } catch {
        aiFailed = true
      }
    }

    // 2) Deterministic resolution — ALWAYS runs. Apply matched columns, mark
    //    absent OPTIONAL inputs not-in-data, keep missing CORE demographics
    //    flagged (can't be invented), and acknowledge every disclosure.
    const applied: { field: string; column: string }[] = []
    const notInData: string[] = []
    const critical: string[] = []
    const toDismiss: string[] = []
    for (const i of mapIssues) {
      const it = i as Extract<Issue, { kind: "map" }>
      if (patch[it.field]) applied.push({ field: it.field, column: patch[it.field] })
      else if (it.severity === "warn") {
        notInData.push(it.label)
        toDismiss.push(it.id) // stable map:<field> id — survives the re-run below
      } else critical.push(it.label)
    }
    const ack = issues.filter((i) => i.kind === "notice").length
    if (toDismiss.length) setDismissed((d) => new Set([...d, ...toDismiss]))
    if (ack) setAckNotices(true)
    if (applied.length) onMapping({ ...payload.mapping, ...patch })
    setResolution({ applied, notInData, ack, critical })

    // "off" surfaces the manual-mapping hint only when real work remains: a core
    // demographic the AI couldn't find, or the call failed with nothing applied.
    setAiState(critical.length || (aiFailed && mapIssues.length && !applied.length) ? "off" : "done")
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!issues.length) return
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault()
      setSelected((s) => Math.min(issues.length - 1, s + 1))
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const cur = issues[selected]
      if (!cur) return
      if (cur.kind === "map") {
        const col = chosen[cur.field]
        if (col) applyMap(cur.field, col)
      } else {
        dismiss(cur.id)
      }
    }
  }

  if (!issues.length) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-small text-emerald-700 dark:text-emerald-300">
        <div className="flex items-center gap-2 font-medium">
          <CircleCheck size={16} /> All clear — your columns are mapped and the sample is ready.
        </div>
        {resolution && (resolution.applied.length > 0 || resolution.notInData.length > 0 || resolution.ack > 0) && (
          <ul className="mt-1.5 ml-6 list-disc space-y-0.5 text-tiny text-emerald-700/80 dark:text-emerald-300/80">
            {resolution.applied.length > 0 && (
              <li>Mapped {resolution.applied.length}: {resolution.applied.map((a) => `${FIELD_META[a.field]?.label ?? a.field} → ${a.column.length > 28 ? a.column.slice(0, 27) + "…" : a.column}`).join(" · ")}</li>
            )}
            {resolution.notInData.length > 0 && <li>Marked not-in-data (optional, model proceeds without): {resolution.notInData.join(" · ")}</li>}
            {resolution.ack > 0 && <li>Acknowledged {resolution.ack} disclosure{resolution.ack === 1 ? "" : "s"} (kept in the report methodology)</li>}
          </ul>
        )}
      </div>
    )
  }

  const errorCount = issues.filter((i) => i.severity === "error").length

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-lg border border-foreground/15 bg-foreground/[0.02] outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-2.5">
        <div className="flex items-center gap-2 text-small font-semibold">
          <TriangleAlert size={15} className="text-amber-500" />
          {issues.length} issue{issues.length === 1 ? "" : "s"} to review
          {mapIssues.length > 0 && <span className="font-normal text-foreground/55">· {mapIssues.length} fixable{errorCount ? ` · ${errorCount} critical` : ""}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-tiny text-foreground/40 sm:inline">↑↓ move · Enter apply</span>
          <button
            type="button"
            onClick={runAi}
            disabled={aiState === "loading"}
            title="Resolve every issue in one click: apply confident column matches, mark absent optional inputs as not-in-data, and acknowledge disclosures. Missing core demographics stay flagged — never invented."
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-tiny font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {aiState === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Fix with AI
          </button>
        </div>
      </div>

      {aiState === "off" && (
        <div className="border-b border-foreground/10 bg-amber-500/[0.05] px-4 py-1.5 text-tiny text-foreground/60">
          AI didn&apos;t find a confident match (or isn&apos;t configured). Map these manually below — pick the right column and Apply.
        </div>
      )}

      {resolution && (resolution.applied.length > 0 || resolution.notInData.length > 0 || resolution.ack > 0 || resolution.critical.length > 0) && (
        <div className="border-b border-foreground/10 bg-emerald-500/[0.05] px-4 py-2 text-tiny text-foreground/70">
          <div className="flex items-start gap-1.5">
            <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />
            <div className="flex flex-col gap-0.5">
              {resolution.applied.length > 0 && (
                <span>
                  <span className="font-medium text-foreground/85">Mapped {resolution.applied.length}:</span>{" "}
                  {resolution.applied.map((a) => `${FIELD_META[a.field]?.label ?? a.field} → ${a.column.length > 28 ? a.column.slice(0, 27) + "…" : a.column}`).join(" · ")}
                </span>
              )}
              {resolution.notInData.length > 0 && (
                <span>
                  <span className="font-medium text-foreground/85">Marked not in your data ({resolution.notInData.length}):</span>{" "}
                  {resolution.notInData.join(" · ")} — these are optional, the model proceeds without them.
                </span>
              )}
              {resolution.ack > 0 && (
                <span>
                  <span className="font-medium text-foreground/85">Acknowledged {resolution.ack} disclosure{resolution.ack === 1 ? "" : "s"}</span> — still noted in the report methodology.
                </span>
              )}
              {resolution.critical.length > 0 && (
                <span className="text-rose-600 dark:text-rose-400">
                  {resolution.critical.length} core demographic{resolution.critical.length === 1 ? "" : "s"} ({resolution.critical.join(", ")}) {resolution.critical.length === 1 ? "isn't" : "aren't"} in your data and can&apos;t be invented — map manually or upload data that includes {resolution.critical.length === 1 ? "it" : "them"}.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="divide-y divide-foreground/[0.06]">
        {issues.map((issue, idx) => {
          const active = idx === selected
          const sev = issue.severity
          const Icon = sev === "error" ? CircleAlert : sev === "warn" ? TriangleAlert : Info
          const sevColor = sev === "error" ? "text-rose-500" : sev === "warn" ? "text-amber-500" : "text-foreground/40"
          // For a notice about a demographic dimension, surface the actual values
          // found in the data so the user can see exactly what tripped it.
          const noticeDim = issue.kind === "notice" ? payload.composition.find((c) => issue.detail.includes(c.label)) : undefined
          return (
            <div
              key={issue.id}
              onClick={() => setSelected(idx)}
              className={`cursor-pointer px-4 py-2.5 transition-colors ${active ? "bg-primary/[0.05]" : "hover:bg-foreground/[0.02]"}`}
            >
              <div className="flex items-start gap-2.5">
                <Icon size={15} className={`mt-0.5 shrink-0 ${sevColor}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-small font-medium">
                    {issue.kind === "map" ? issue.label : issue.title}
                    {active && <span className="rounded bg-primary/15 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">selected</span>}
                  </div>
                  <div className="mt-0.5 text-tiny text-foreground/60">{issue.kind === "map" ? issue.detail : issue.detail}</div>

                  {active && issue.kind === "map" && (
                    <FixRow
                      headers={payload.headers}
                      example={issue.example}
                      label={issue.label}
                      columnSamples={payload.columnSamples}
                      suggestion={suggestions[issue.field]}
                      value={chosen[issue.field] ?? suggestions[issue.field]?.column ?? ""}
                      onChange={(v) => setChosen((c) => ({ ...c, [issue.field]: v }))}
                      onApply={(v) => applyMap(issue.field, v)}
                      onSkip={() => dismiss(issue.id)}
                    />
                  )}
                  {active && issue.kind === "notice" && (
                    <div className="mt-2 flex flex-col gap-2">
                      {noticeDim && (
                        <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] px-2.5 py-2 text-tiny">
                          <span className="text-foreground/50">Found in your data — {noticeDim.label} ({noticeDim.values.length}): </span>
                          <span className="inline-flex flex-wrap gap-1 align-middle">
                            {noticeDim.values.slice(0, 8).map((v) => (
                              <Chip key={v.value}>{v.value}</Chip>
                            ))}
                          </span>
                          {/region/i.test(noticeDim.label) && (
                            <div className="mt-1.5 text-foreground/45">
                              The built-in benchmark uses 8 national Census-division regions, so these don&apos;t line up. Weight Region to your own
                              targets in the variables below, or in Custom weighting.
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); dismiss(issue.id) }}
                        className="inline-flex h-7 w-fit items-center gap-1 rounded-md border border-foreground/15 px-2.5 text-tiny font-medium text-foreground/70 hover:bg-foreground/5"
                      >
                        <Check size={12} /> Got it
                      </button>
                    </div>
                  )}
                </div>
                {!active && issue.kind === "notice" && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); dismiss(issue.id) }}
                    title="Dismiss"
                    className="shrink-0 rounded p-1 text-foreground/30 hover:bg-foreground/10 hover:text-foreground/60"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${accent ? "bg-primary/10 text-primary" : "bg-foreground/[0.07] text-foreground/65"}`}>
      {children}
    </span>
  )
}

function FixRow({
  headers,
  example,
  label,
  columnSamples,
  suggestion,
  value,
  onChange,
  onApply,
  onSkip,
}: {
  headers: string[]
  example: string[]
  label: string
  columnSamples: Record<string, string[]>
  suggestion?: MappingSuggestion
  value: string
  onChange: (v: string) => void
  onApply: (v: string) => void
  onSkip: () => void
}) {
  const selectedSamples = value ? columnSamples[value] ?? [] : []
  return (
    <div className="mt-2 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="rounded-md border border-foreground/10 bg-foreground/[0.02] px-2.5 py-2 text-tiny">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-foreground/50">A good {label} column looks like:</span>
          {example.map((e) => (
            <Chip key={e} accent>{e}</Chip>
          ))}
        </div>
        {value && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-foreground/50">“{value.length > 32 ? value.slice(0, 31) + "…" : value}” contains:</span>
            {selectedSamples.length ? selectedSamples.map((s) => <Chip key={s}>{s}</Chip>) : <span className="text-foreground/40">(no preview)</span>}
          </div>
        )}
      </div>
      {suggestion && (
        <div className="text-tiny">
          {suggestion.column ? (
            <span className="text-primary">
              <Sparkles size={11} className="mr-1 inline" />
              AI suggests <span className="font-semibold">{suggestion.column.length > 44 ? suggestion.column.slice(0, 43) + "…" : suggestion.column}</span>
              {suggestion.reason ? <span className="text-foreground/50"> — {suggestion.reason}</span> : null}
            </span>
          ) : (
            <span className="text-foreground/50">AI found no matching column — this question may not be in your data.</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 max-w-[280px] flex-1 rounded-md border border-foreground/15 bg-background px-2 text-tiny outline-none focus:border-primary/50"
        >
          <option value="">— pick a column —</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h.length > 50 ? h.slice(0, 49) + "…" : h}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onApply(value)}
          disabled={!value}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-tiny font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          <Check size={12} /> Apply
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="inline-flex h-8 items-center rounded-md border border-foreground/15 px-2.5 text-tiny font-medium text-foreground/60 hover:bg-foreground/5"
        >
          Not in my data
        </button>
      </div>
    </div>
  )
}
