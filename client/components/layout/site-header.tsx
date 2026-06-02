"use client"

import type { MouseEvent } from "react"
import { Wordmark } from "@/components/brand/logo"
import { Container } from "./container"
import { ThemeToggle } from "./theme-toggle"

export function SiteHeader() {
  // Plain left-click returns to the upload screen in place (no reload);
  // modifier-clicks fall through to the real link so "open in new tab" works.
  const goHome = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    window.history.replaceState(null, "", "/")
    window.dispatchEvent(new Event("toplines:home"))
  }
  return (
    <header className="pt-3">
      <Container>
        <div className="psi-topbar psi-shadow-lg flex h-[52px] items-center gap-3 rounded-xl px-4">
          <a
            href="/"
            onClick={goHome}
            aria-label="Toplines home"
            title="Back to home"
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-[#93c5fd]/50"
          >
            <Wordmark size={22} tone="light" />
          </a>
          <span className="hidden h-5 w-px bg-white/15 sm:block" />
          <span className="hidden font-mono text-tiny text-white/55 sm:block">
            PSI Pathway 3 · Poll Tool
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded bg-emerald-400/15 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-emerald-300 sm:inline">
              CSV → REPORT
            </span>
            <ThemeToggle tone="onNavy" />
          </div>
        </div>
      </Container>
    </header>
  )
}
