// "light" tone is for placement on the navy topbar; "default" keeps the brand
// accent (primary) used elsewhere on light/dark surfaces.
type Tone = "default" | "light"

export function Logo({ size = 28, tone = "default" }: { size?: number; tone?: Tone }) {
  const rect = tone === "light" ? "#93c5fd" : undefined
  const bars = tone === "light" ? "#0f2a5e" : "#ffffff"
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" className={tone === "light" ? "" : "fill-primary"} fill={rect} />
      <rect x="8" y="9" width="16" height="3.2" rx="1.6" fill={bars} />
      <rect x="8" y="14.4" width="11" height="3.2" rx="1.6" fill={bars} fillOpacity="0.85" />
      <rect x="8" y="19.8" width="7" height="3.2" rx="1.6" fill={bars} fillOpacity="0.7" />
    </svg>
  )
}

export function Wordmark({ size = 28, tone = "default" }: { size?: number; tone?: Tone }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} tone={tone} />
      <span
        className={`font-mono text-h3 font-bold tracking-tight ${
          tone === "light" ? "text-[#93c5fd]" : "text-foreground"
        }`}
      >
        Toplines
      </span>
    </span>
  )
}
