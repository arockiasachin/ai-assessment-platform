"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogOut, User } from "lucide-react"

import { BRAND } from "@/components/shell/nav-config"
import { useGradebook } from "@/components/gradebook-provider"

export function DashboardHeader() {
  const { role } = useGradebook()
  const [authenticated, setAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" })
        const data = await response.json()
        setAuthenticated(Boolean(data.authenticated))
      } catch {
        setAuthenticated(false)
      } finally {
        setIsLoading(false)
      }
    }

    loadSession()
  }, [])

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      setAuthenticated(false)
      window.location.href = "/login"
    } catch {
      window.location.href = "/login"
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BRAND.icon className="size-5" aria-hidden="true" />
          </div>
          <div>
            {/*
             * Read from `BRAND`, not literals: this header serves the ~25 pages
             * still on `RolePageShell`, and it carried the retired "Gradebook —
             * Assessment & marks tracker" wordmark while the design system, the
             * app shell and the auth screens had all moved to Rubrix. One source
             * means the old and new chrome cannot disagree about the name.
             */}
            <h1 className="text-base leading-none font-semibold tracking-tight">{BRAND.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{BRAND.tagline}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {isLoading ? (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground">
                <User className="size-4" />
                Loading...
              </div>
            ) : authenticated ? (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <LogOut className="size-4" />
                Logout
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <User className="size-4" />
                Login
              </Link>
            )}
          </div>

          <div
            role="status"
            aria-label="Current view"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-sm font-medium text-foreground"
          >
            <User className="size-4" />
            {role === "teacher" ? "Teacher view" : "Student view"}
          </div>
        </div>
      </div>
    </header>
  )
}
