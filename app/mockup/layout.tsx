import type { Metadata } from "next"

import { AppShell } from "@/components/shell/app-shell"
import { themeInitScript } from "@/components/shell/theme-toggle"
import { formatRelativeTime } from "@/lib/mock/format"
import { MOCK_CURRENT_USER, MOCK_NOTIFICATIONS } from "@/lib/mock/session"

/**
 * Mockup shell.
 *
 * `/mockup` is deliberately outside the auth proxy (`proxy.ts` does not match it) so the owner can
 * review every screen while logged out. There are no auth guards here — do not add any.
 *
 * The role the chrome renders for is derived inside `AppShell` from the first `/mockup/<role>` path
 * segment, which keeps this layout role-agnostic.
 *
 * **This layout is where `lib/mock` meets the shell, and it is the only place.** `AppShell` and
 * `TopBar` used to import `MOCK_NOTIFICATIONS` / `MOCK_CURRENT_USER` themselves, which put the mock
 * layer inside a component the real app also renders. Now the fixtures and their relative clock are
 * supplied from here as props, so the dependency points one way: the design-reference tree reads the
 * mock layer, and the shell reads nothing. That is what lets `lib/mock` be scoped to `/mockup`
 * rather than being load-bearing for the app.
 */
export const metadata: Metadata = {
  title: {
    default: "Rubrix UI mockups",
    template: "%s · Rubrix mockups",
  },
  description:
    "Static UI mockups for the AI assessment platform: no backend, no database, no authentication.",
}

export default function MockupLayout({ children }: { children: React.ReactNode }) {
  // Formatted here rather than in the shell: `formatRelativeTime` is anchored to the mockup's
  // fixed `MOCK_NOW`, so it is the mockup's clock to apply, not the shell's.
  const notifications = MOCK_NOTIFICATIONS.map((notification) => ({
    id: notification.id,
    title: notification.title,
    description: notification.description,
    whenLabel: formatRelativeTime(notification.createdAt),
    tone: notification.tone,
    read: notification.read,
  }))

  return (
    <>
      {/*
        Pre-paint theme bootstrap. It must run before the shell is painted so a
        dark-mode visitor never sees a light flash, and so Tailwind's `.dark`
        utility variants agree with the `prefers-color-scheme` token block in
        globals.css. See components/shell/theme-toggle.tsx.
      */}
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <AppShell mockUsers={MOCK_CURRENT_USER} notifications={notifications}>
        {children}
      </AppShell>
    </>
  )
}
