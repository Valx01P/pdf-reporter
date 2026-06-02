import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  title,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: LucideIcon
  title?: string
}) {
  return (
    <div title={title} className="psi-shadow rounded-lg border border-foreground/10 bg-surface px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={11} className="text-primary" />}
        <span className="text-tiny font-semibold uppercase tracking-wider text-foreground/50">{label}</span>
      </div>
      <div className="mt-1 font-mono text-h3 font-bold tabular-nums">{value}</div>
      {hint && <div className="text-tiny text-foreground/45">{hint}</div>}
    </div>
  )
}

export function StatBar({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">{children}</div>
}
