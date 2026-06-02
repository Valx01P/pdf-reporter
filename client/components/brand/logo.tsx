// Theme-aware brand. Light mode: blue mark + white bars + navy wordmark (reads on
// the white top bar). Dark mode: light-blue mark + navy bars + light-blue wordmark
// (reads on the navy top bar). Driven by `dark:` classes so it never flashes.
export function Logo({ size = 28 }: { size?: number }) {
  const bars = "fill-white dark:fill-[#0f2a5e]"
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary dark:fill-[#93c5fd]" />
      <rect x="8" y="9" width="16" height="3.2" rx="1.6" className={bars} />
      <rect x="8" y="14.4" width="11" height="3.2" rx="1.6" className={bars} fillOpacity="0.85" />
      <rect x="8" y="19.8" width="7" height="3.2" rx="1.6" className={bars} fillOpacity="0.7" />
    </svg>
  )
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Logo size={size} />
      <span className="font-mono text-h3 font-bold tracking-tight text-navy dark:text-[#93c5fd]">
        Toplines
      </span>
    </span>
  )
}
