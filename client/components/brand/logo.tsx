export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="8" y="9" width="16" height="3.2" rx="1.6" fill="#ffffff" />
      <rect x="8" y="14.4" width="11" height="3.2" rx="1.6" fill="#ffffff" fillOpacity="0.85" />
      <rect x="8" y="19.8" width="7" height="3.2" rx="1.6" fill="#ffffff" fillOpacity="0.7" />
    </svg>
  )
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="text-h3 font-semibold tracking-tight">Toplines</span>
    </span>
  )
}
