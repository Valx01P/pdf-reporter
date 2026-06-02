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
    <header className="border-b border-foreground/10">
      <Container>
        <div className="flex h-14 items-center justify-between">
          <a
            href="/"
            onClick={goHome}
            aria-label="Toplines home"
            title="Back to home"
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Wordmark size={24} />
          </a>
          <ThemeToggle />
        </div>
      </Container>
    </header>
  )
}
