"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === "dark"
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label="Toggle theme"
      // Sits on the white bar in light mode, the navy bar in dark mode.
      className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors text-foreground/70 hover:bg-foreground/5 hover:text-foreground dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
    >
      {mounted ? isDark ? <Sun size={18} /> : <Moon size={18} /> : <span className="size-[18px]" />}
    </button>
  )
}
