"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ROLE_META,
  BRAND,
  roleFromPathname,
  type MockupRole,
  type NavScope,
} from "@/components/shell/nav-config"
import { SideNav } from "@/components/shell/side-nav"
import { TopBar, type TopBarUser } from "@/components/shell/top-bar"

type AppShellProps = {
  children: React.ReactNode
  /**
   * Override the role the chrome is rendered for. Normally omitted: the shell
   * derives the role from the pathname — the segment after `/mockup`, or the
   * first segment in `app` scope.
   */
  role?: MockupRole
  /** Role used when the pathname names no role (e.g. `/mockup` itself). */
  defaultRole?: MockupRole
  /**
   * Which tree this shell wraps. `mockup` (the default) links to the static
   * mockup routes and keeps the mockup-only affordances; `app` links to the real
   * authenticated routes and drops the mockup chrome. Defaulting to `mockup`
   * keeps every existing mockup page byte-identical.
   *
   * In `app` scope always pass `role` explicitly, or ensure the first path
   * segment is a role. `defaultRole` still applies as a fallback, so a real page
   * at a role-less path would silently render the teacher chrome — `proxy.ts`
   * makes that unreachable today (it only lets `/teacher|/student|/admin`
   * through), but the fallback is retained rather than throwing during render.
   */
  scope?: NavScope
  /** Real signed-in user, shown in `app` scope. Falls back to the mock identity. */
  user?: TopBarUser
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
export function AppShell({
  children,
  role: roleProp,
  defaultRole = "teacher",
  scope = "mockup",
  user,
}: AppShellProps) {
  const pathname = usePathname()
  const role = roleProp ?? roleFromPathname(pathname, scope) ?? defaultRole
  const [collapsed, setCollapsed] = useState(false)
  // Scoped DOM ids: a real page should not carry `mockup-*` ids (and a mockup
  // page must keep them), so the prefix follows the scope.
  const mainId = scope === "mockup" ? "mockup-main" : "app-main"
  const sidebarId = scope === "mockup" ? "mockup-sidebar" : "app-sidebar"

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <div className="md:flex">
        <aside
          id={sidebarId}
          aria-label="Workspace navigation"
          className={cn(
            // Visible from `md` up; the mobile drawer covers narrower viewports.
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar md:flex",
            // Icon rail below `lg`; full label rail from `lg` unless collapsed.
            collapsed ? "w-16" : "w-16 lg:w-64",
          )}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
            {/*
             * Icon-only rail (md–lg, and the collapsed lg rail): the role label
             * is `sr-only` and the collapse toggle only exists from `lg`, so
             * without a mark this 56px strip is an empty band with a border
             * under it. The top bar's brand mark anchors it, and stays
             * `aria-hidden` because the role label still names the workspace.
             */}
            <span
              aria-hidden="true"
              className="mx-auto hidden size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground md:flex lg:hidden"
            >
              <BRAND.icon className="size-4" />
            </span>
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
              aria-controls={sidebarId}
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
            <SideNav role={role} scope={scope} collapsed={collapsed} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar role={role} scope={scope} user={user} />
          <main id={mainId} className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
