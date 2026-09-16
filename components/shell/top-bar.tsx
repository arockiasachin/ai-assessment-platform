"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Popover } from "@base-ui/react/popover"
import { Bell, ChevronDown, LogOut, Search, UserRound } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { StatusDot, StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  BRAND,
  PREVIEW_ROLES,
  ROLE_META,
  brandHref,
  type MockupRole,
  type NavScope,
} from "@/components/shell/nav-config"
import { MobileNav } from "@/components/shell/mobile-nav"
import { ThemeToggle } from "@/components/shell/theme-toggle"

/** The signed-in identity the top bar renders. */
export type TopBarUser = {
  name: string
  email: string
  initials: string
  roleLabel: string
}

/**
 * A notification as the top bar renders it.
 *
 * **Mockup-only data, declared here rather than imported.** There is no `Notification` model, so
 * this is a view shape the design-reference tree supplies — and the app never does. The timestamp
 * arrives already formatted because the mockup's relative clock (`MOCK_NOW`) belongs to the
 * mockup; the shell must not own a mock clock, or app scope would inherit one.
 */
export type TopBarNotification = {
  id: string
  title: string
  description: string
  /** Pre-formatted by the caller, e.g. "2 days ago". */
  whenLabel: string
  tone: StatusKey
  read: boolean
}

/**
 * Sticky application top bar.
 *
 * Renders entirely from props — there is no `fetch` and no effect, so the chrome paints on the
 * first frame (no "Loading…" flash). The search field is intentionally inert: visually complete so
 * reviewers can judge the composition, but it does not submit anywhere.
 *
 * **Mockup-only data arrives as props rather than imports.** This component used to import
 * `MOCK_NOTIFICATIONS` and `MOCK_CURRENT_USER` directly, which meant a *real* shell component
 * depended on the mock layer at module scope. It now takes them from the caller: the mockup layout
 * supplies its fixtures, and app scope supplies only the signed-in user from the server. In `app`
 * scope the mockup-only affordances are dropped — no preview role switcher, no mockup index link,
 * and no notifications menu, because there is no `Notification` model and rendering one would be
 * fabricating data. Sign-out is real.
 */
export function TopBar({
  role,
  scope = "mockup",
  user,
  mockUsers,
  notifications = [],
}: {
  role: MockupRole
  scope?: NavScope
  user?: TopBarUser
  /**
   * Per-role demo identities for when no real user is passed. Mockup-only; omitted in app scope,
   * where `user` always comes from the session.
   */
  mockUsers?: Partial<Record<MockupRole, TopBarUser & { roleTone: StatusKey }>>
  /** Mockup-only. Empty in app scope, which renders no notification affordance at all. */
  notifications?: TopBarNotification[]
}) {
  // Search is mockup-only until it is wired up, so this id only ever renders
  // there. Keeping the name scope-specific means an app-scope search can be
  // added later without colliding with the mockup one.
  const searchId = "mockup-search"

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <MobileNav role={role} scope={scope} />

        <Link
          href={brandHref(scope, role)}
          className="flex shrink-0 items-center gap-2.5 rounded-lg py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BRAND.icon className="size-5" aria-hidden="true" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block text-sm leading-none font-semibold tracking-tight">
              {BRAND.name}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {BRAND.tagline}
            </span>
          </span>
        </Link>

        {/*
         * The search field is a deliberately inert placeholder in the mockups —
         * it has no submit handler and the ⌘K hint is decorative. That is fine on
         * a design screen, but shipping a labelled `role="search"` landmark that
         * silently swallows keystrokes onto a real authenticated page is a
         * dangling affordance, so it is mockup-only until search is wired up.
         * The old real header had no search at all, so this is not a regression.
         */}
        {scope === "mockup" && (
          <form
            role="search"
            onSubmit={(event) => event.preventDefault()}
            className="relative ml-auto hidden w-full max-w-sm md:block"
          >
            <label htmlFor={searchId} className="sr-only">
              Search assessments, students and questions
            </label>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              placeholder="Search assessments, students, questions…"
              className="pl-8 pr-12"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
            >
              ⌘K
            </kbd>
          </form>
        )}

        <div className="ml-auto flex items-center gap-1 md:ml-2">
          {scope === "mockup" && notifications.length > 0 && (
            <NotificationsMenu notifications={notifications} />
          )}
          <ThemeToggle />
          <UserMenu role={role} scope={scope} user={user} mockUsers={mockUsers} />
        </div>
      </div>
    </header>
  )
}

function NotificationsMenu({ notifications }: { notifications: TopBarNotification[] }) {
  const unread = notifications.filter((notification) => !notification.read).length
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="ghost" size="icon" className="relative text-muted-foreground" />}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[0.6rem] leading-none text-primary-foreground"
          >
            {unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-80 rounded-xl bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              <span className="text-xs text-muted-foreground">{unread} unread</span>
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60"
                >
                  <StatusDot status={notification.tone} className="mt-1.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">{notification.title}</p>
                    <p className="text-xs text-muted-foreground">{notification.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{notification.whenLabel}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function UserMenu({
  role,
  scope,
  user: userProp,
  mockUsers,
}: {
  role: MockupRole
  scope: NavScope
  user?: TopBarUser
  mockUsers?: Partial<Record<MockupRole, TopBarUser & { roleTone: StatusKey }>>
}) {
  const demoUser = mockUsers?.[role]
  // If neither is supplied, render a neutral identity rather than crashing: app scope always
  // passes a real user, and the mockup layout always passes the demo record, so this is the
  // "neither" case that should not happen — but a chrome component must not throw on it.
  const user: TopBarUser = userProp ??
    demoUser ?? {
      name: "",
      email: "",
      initials: "?",
      roleLabel: ROLE_META[role].label,
    }
  // A real signed-in user is active by definition; the demo identities carry per-role tones so the
  // pill has something varied to show.
  const roleTone: StatusKey = userProp ? "active" : (demoUser?.roleTone ?? "active")

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="ghost" size="sm" className="gap-2 pl-1" />}
        aria-label={`Account menu for ${user.name}`}
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-primary/10 font-medium text-primary">
            {user.initials}
          </AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate lg:inline">{user.name}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-72 rounded-xl bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <div className="flex items-center gap-3 px-4 py-3">
              <Avatar>
                <AvatarFallback className="bg-primary/10 font-medium text-primary">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                {/* The real `User` has no name column, so the label and the email
                    are the same string in `app` scope; don't print it twice. */}
                {user.email !== user.name && (
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                )}
              </div>
            </div>
            <Separator />
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Signed in as
              </p>
              <div className="px-2 pb-2">
                <StatusPill status={roleTone} label={`${user.roleLabel} role`} />
              </div>
              {scope === "mockup" ? (
                <>
                  <p className="px-2 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Preview role
                  </p>
                  <ul>
                    {/*
                     * `PREVIEW_ROLES`, not `MOCKUP_ROLES`: the admin workspace is
                     * unadvertised (provisioned by invitation), so it is not
                     * offered here. It stays reachable by URL and from the
                     * mockup index footer.
                     */}
                    {PREVIEW_ROLES.map((previewRole) => (
                      <li key={previewRole}>
                        <Link
                          href={ROLE_META[previewRole].home}
                          aria-current={previewRole === role ? "page" : undefined}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                        >
                          <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span className="flex-1">{ROLE_META[previewRole].label} workspace</span>
                          {previewRole === role && (
                            <span className="text-xs text-muted-foreground">current</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Separator className="my-2" />
                  <Link
                    href={BRAND.indexHref}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    Mockup index
                  </Link>
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Sign out is disabled in mockups.
                  </p>
                </>
              ) : (
                <>
                  <Separator className="my-2" />
                  <SignOutButton />
                </>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Real sign-out, for `app` scope only.
 *
 * Deliberately does **not** navigate on failure. An earlier version swallowed the
 * error and pushed to `/login` regardless, which is the worst outcome on a shared
 * machine: the cookie survives, `proxy.ts` bounces the still-signed-in user off
 * `/login` back to their workspace, and they believe they signed out. So the
 * failure is surfaced instead, and the redirect only happens once the server has
 * confirmed the session was cleared.
 *
 * `router.replace` (not `push`) so Back does not return to the protected page.
 * `window.location` is avoided because the repo lints against assigning an
 * internal path to it.
 */
function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function signOut() {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error(`logout failed: ${response.status}`)
      router.replace("/login")
      router.refresh()
    } catch {
      setFailed(true)
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        // `aria-disabled` rather than `disabled`: a disabled button drops out of
        // the tab order mid-request, which loses the user's focus position.
        aria-disabled={pending}
        onClick={signOut}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted aria-disabled:opacity-60"
      >
        <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          Could not sign out. Check your connection and try again.
        </p>
      )}
    </>
  )
}
