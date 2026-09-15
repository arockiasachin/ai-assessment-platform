"use client"

import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Theme persistence key. Kept in one place so the pre-paint bootstrap script in
 * `app/mockup/layout.tsx` and the toggle can never drift.
 */
export const THEME_STORAGE_KEY = "rubrix-theme"

/**
 * Pre-paint theme bootstrap.
 *
 * `app/globals.css` ships both an explicit `.dark` block and a
 * `prefers-color-scheme` block, but the Tailwind `dark:` variant is defined as
 * `&:is(.dark *)` — so utility variants (e.g. `dark:bg-success/20`) only apply
 * when a `.dark` class actually exists on `<html>`. Materialising the system
 * preference into a class before first paint keeps tokens and utility variants
 * in agreement and avoids a light-theme flash for dark-mode users.
 *
 * Rendered as an inline script inside `app/mockup/layout.tsx`; the root
 * `<html>` already carries `suppressHydrationWarning`, so mutating its class
 * list pre-hydration cannot produce a hydration error.
 */
export const themeInitScript = `(function(){try{var k="${THEME_STORAGE_KEY}";var s=localStorage.getItem(k);var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d);}catch(e){}})()`

/**
 * Light/dark toggle for the mockup shell.
 *
 * Deliberately stateless: the icon pair is switched by CSS off the `.dark`
 * ancestor, so server and client render identical markup and there is no
 * hydration mismatch or theme flash.
 */
export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement
    const next = root.classList.contains("dark") ? "light" : "dark"
    root.classList.toggle("dark", next === "dark")
    root.classList.toggle("light", next === "light")
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Persistence is best-effort: private browsing can block localStorage.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="text-muted-foreground hover:text-foreground"
    >
      <Sun className="size-4 dark:hidden" aria-hidden="true" />
      <Moon className="hidden size-4 dark:block" aria-hidden="true" />
    </Button>
  )
}
