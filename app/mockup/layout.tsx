import type { Metadata } from "next"

import { AppShell } from "@/components/shell/app-shell"
import { themeInitScript } from "@/components/shell/theme-toggle"

/**
 * Mockup shell.
 *
 * `/mockup` is deliberately outside the auth proxy (`proxy.ts` does not match it)
 * so the owner can review every screen while logged out. There are no auth
 * guards here — do not add any.
 *
 * The role the chrome renders for is derived inside `AppShell` from the first
 * `/mockup/<role>` path segment, which keeps this layout role-agnostic.
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
  return (
    <>
      {/*
        Pre-paint theme bootstrap. It must run before the shell is painted so a
        dark-mode visitor never sees a light flash, and so Tailwind's `.dark`
        utility variants agree with the `prefers-color-scheme` token block in
        globals.css. See components/shell/theme-toggle.tsx.
      */}
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      <AppShell>{children}</AppShell>
    </>
  )
}
