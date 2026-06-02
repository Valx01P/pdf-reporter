import type { ReactNode } from "react"

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`psi-shadow rounded-xl border border-hairline bg-surface ${className}`}>{children}</div>
}

export function CardHeader({
  title,
  hint,
  action,
  className = "",
}: {
  title: ReactNode
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3 ${className}`}>
      <div className="flex min-w-0 flex-col">
        <h3 className="truncate text-small font-semibold">{title}</h3>
        {hint && <span className="truncate text-tiny text-foreground/50">{hint}</span>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>
}
