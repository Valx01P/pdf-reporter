"use client"

import { MessageSquareQuote } from "lucide-react"
import { BarList } from "@/components/charts/bar-list"
import { StackedScaleBar } from "@/components/charts/stacked-scale-bar"
import { Card } from "@/components/ui/card"
import type { Question } from "@/lib/types"
import type { QuestionToplines } from "@/lib/psi/service"

const TYPE_LABEL: Record<Question["type"], string> = {
  categorical: "Multiple choice",
  scale: "Scale",
  binary: "Yes / No",
  numeric: "Numeric",
  nps: "Net Promoter",
  open_ended: "Open-ended",
}

function QuestionBody({ q }: { q: Question }) {
  if (q.type === "open_ended") {
    return (
      <div className="flex flex-col gap-2">
        {(q.openSamples || []).slice(0, 5).map((s, i) => (
          <div key={i} className="flex gap-2 rounded-md bg-foreground/[0.03] px-3 py-2 text-tiny text-foreground/75">
            <MessageSquareQuote size={13} className="mt-0.5 shrink-0 text-primary" />
            <span>{s}</span>
          </div>
        ))}
        {(q.openCount || 0) > 5 && <div className="text-tiny text-foreground/45">+ {(q.openCount || 0) - 5} more responses</div>}
      </div>
    )
  }
  if (q.type === "numeric") {
    if (!q.numeric) return <div className="text-tiny text-foreground/50">No numeric responses.</div>
    const s = q.numeric
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[["Mean", s.mean], ["Median", s.median], ["Min", s.min], ["Max", s.max], ["SD", s.stdev]].map(([k, v]) => (
          <div key={k as string} className="rounded-md bg-foreground/[0.03] px-2.5 py-1.5">
            <div className="text-tiny text-foreground/50">{k}</div>
            <div className="font-mono text-small font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    )
  }
  if (q.type === "scale") {
    return <StackedScaleBar options={q.options} neutralIndex={q.scaleMeta?.neutralIndex ?? -1} />
  }
  return <BarList items={q.options.map((o) => ({ label: o.label, pct: o.pct, count: o.weighted }))} />
}

export function DualQuestionCard({ topline, index }: { topline: QuestionToplines; index: number }) {
  const { rv, lv, type, prompt } = topline
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-foreground/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 font-mono text-tiny font-semibold text-foreground/40">Q{index + 1}</span>
          <h3 className="text-small font-semibold leading-snug">{prompt}</h3>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-6 text-tiny text-foreground/45">
          <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5">{TYPE_LABEL[type]}</span>
          <span>n={rv.answered.toLocaleString()}</span>
          <span>· RV ±{rv.moe}%</span>
          <span>· LV ±{lv.moe}%</span>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-foreground/[0.06] md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="p-4">
          <div className="mb-2.5 text-tiny font-semibold uppercase tracking-wider text-foreground/50">Registered voters</div>
          <QuestionBody q={rv} />
        </div>
        <div className="p-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-tiny font-semibold uppercase tracking-wider text-primary">
            <span className="size-1.5 rounded-full bg-primary" />
            Likely voters
          </div>
          <QuestionBody q={lv} />
        </div>
      </div>
    </Card>
  )
}
