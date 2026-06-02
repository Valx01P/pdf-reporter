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
        <div className="psi-navbar flex h-[52px] items-center gap-3 rounded-xl px-4">
          <a
            href="/"
            onClick={goHome}
            aria-label="Toplines home"
            title="Back to home"
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:focus-visible:ring-[#93c5fd]/50"
          >
            <Wordmark size={22} />
          </a>
          <span className="hidden h-5 w-px bg-foreground/15 sm:block dark:bg-white/15" />
          <span className="hidden font-mono text-tiny text-foreground/45 sm:block dark:text-white/55">
            PSI Pathway 3 · Poll Tool
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded bg-emerald-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide text-emerald-700 sm:inline dark:bg-emerald-400/15 dark:text-emerald-300">
              CSV → REPORT
            </span>
            <ThemeToggle />
          </div>
        </div>
      </Container>
    </header>
  )
}
