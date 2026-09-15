"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ROLE_META, roleFromPathname, type MockupRole } from "@/components/shell/nav-config"
import { SideNav } from "@/components/shell/side-nav"
import { TopBar } from "@/components/shell/top-bar"

type AppShellProps = {
  children: React.ReactNode
  /**
   * Override the role the chrome is rendered for. Normally omitted: the shell
   * derives the role from the first `/mockup/<role>` path segment, which keeps
   * `app/mockup/layout.tsx` a single, role-agnostic wrapper.
   */
  role?: MockupRole
  /** Role used for `/mockup` itself, where the URL names no role. */
  defaultRole?: MockupRole
}

/**
 * The application shell: persistent left rail + sticky top bar + scrollable
 * main region.
 *
 * Why this is a Client Component: it needs `usePathname()` for the active nav
 * state and it owns the rail/drawer interactions. It is nonetheless
 * SSR-stable — no `useEffect`, no fetch, no route-dependent state initialised
 * outside render — so the chrome paints immediately with no "Loading…" flash.
 * Everything inside `children` stays a Server Component.
 */
export function AppShell({ children, role: roleProp, defaultRole = "teacher" }: AppShellProps) {
  const pathname = usePathname()
  const role = roleProp ?? roleFromPathname(pathname) ?? defaultRole
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#mockup-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <div className="md:flex">
        <aside
          aria-label="Workspace navigation"
          className={cn(
            // Visible from `md` up; the mobile drawer covers narrower viewports.
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar md:flex",
            // Icon rail below `lg`; full label rail from `lg` unless collapsed.
            collapsed ? "w-16" : "w-16 lg:w-64",
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
            <span
              className={cn(
                "truncate px-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase",
                collapsed ? "sr-only" : "sr-only lg:not-sr-only",
              )}
            >
              {ROLE_META[role].label} workspace
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="ml-auto hidden text-muted-foreground lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
            <SideNav role={role} collapsed={collapsed} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar role={role} />
          <main id="mockup-main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
