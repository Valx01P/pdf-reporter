// Horizontal bar list — the workhorse for categorical, binary, NPS buckets and
// numeric histograms. Brand-colored fills on a neutral track, with the percent
// and raw count aligned to the right.

export interface BarItem {
  label: string
  pct: number
  count?: number
  /** Optional explicit fill (CSS color). Defaults to the brand color. */
  fill?: string
}

export function BarList({ items, showCount = true }: { items: BarItem[]; showCount?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.pct))
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, idx) => (
        <div key={`${it.label}-${idx}`} className="grid grid-cols-[minmax(90px,38%)_1fr_auto] items-center gap-3">
          <span className="truncate text-tiny text-foreground/75" title={it.label}>
            {it.label}
          </span>
          <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.08]">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${(it.pct / max) * 100}%`, background: it.fill }}
            />
          </div>
          <span className="whitespace-nowrap text-tiny font-medium tabular-nums text-foreground/70">
            {it.pct.toFixed(1)}%
            {showCount && it.count != null && (
              <span className="ml-1.5 text-foreground/40">n={Math.round(it.count)}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
