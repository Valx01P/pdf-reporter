// Likert / diverging visualization for ordered scale questions. Renders a
// single 100% stacked bar — negatives in cool grey shades, the neutral point
// muted, positives in brand shades — plus a labelled legend and a net readout.

import type { ToplineOption } from "@/lib/types"

function segColor(idx: number, neutralIdx: number, len: number): string {
  const isNeutral = neutralIdx >= 0 ? idx === neutralIdx : false
  if (isNeutral) return "color-mix(in srgb, var(--foreground) 22%, transparent)"
  const negative = neutralIdx >= 0 ? idx < neutralIdx : idx < len / 2
  // Distance from the center drives intensity so the extremes read strongest.
  const center = neutralIdx >= 0 ? neutralIdx : (len - 1) / 2
  const dist = Math.abs(idx - center)
  const maxDist = Math.max(1, center, len - 1 - center)
  const t = dist / maxDist // 0..1
  if (negative) {
    const pct = 28 + Math.round(t * 34) // 28%..62% foreground
    return `color-mix(in srgb, var(--foreground) ${pct}%, transparent)`
  }
  const pct = 55 + Math.round(t * 45) // 55%..100% primary
  return `color-mix(in srgb, var(--primary) ${pct}%, transparent)`
}

export function StackedScaleBar({
  options,
  neutralIndex,
}: {
  options: ToplineOption[]
  neutralIndex: number
}) {
  const len = options.length
  let pos = 0
  let neg = 0
  options.forEach((o, idx) => {
    if (neutralIndex >= 0) {
      if (idx < neutralIndex) neg += o.pct
      else if (idx > neutralIndex) pos += o.pct
    } else if (idx < len / 2) neg += o.pct
    else pos += o.pct
  })
  const net = Math.round(pos - neg)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded-md">
        {options.map((o, idx) => (
          <div
            key={`${o.label}-${idx}`}
            className="h-full"
            style={{ width: `${o.pct}%`, background: segColor(idx, neutralIndex, len) }}
            title={`${o.label}: ${o.pct.toFixed(1)}%`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {options.map((o, idx) => (
          <div key={`${o.label}-legend-${idx}`} className="flex items-center gap-2 text-tiny">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: segColor(idx, neutralIndex, len) }}
            />
            <span className="truncate text-foreground/70" title={o.label}>
              {o.label}
            </span>
            <span className="ml-auto font-medium tabular-nums text-foreground/60">{o.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-tiny text-foreground/55">
        <span className="font-semibold text-foreground/75">Net {net > 0 ? "+" : ""}{net}</span>
        <span>· positive {pos.toFixed(0)}% − negative {neg.toFixed(0)}%</span>
      </div>
    </div>
  )
}
