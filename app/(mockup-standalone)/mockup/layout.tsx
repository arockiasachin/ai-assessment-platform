import type { Metadata } from "next"

import { themeInitScript } from "@/components/shell/theme-toggle"

/**
 * Standalone mockup layout.
 *
 * The three standalone screens (sign in, register, and the quiz-taking screen)
 * must not render the dashboard chrome — a left rail behind a login form makes
 * no sense. Next.js composes layouts, so a nested `layout.tsx` under
 * `app/mockup/**` would still be wrapped by `app/mockup/layout.tsx`'s
 * `AppShell`. A route group creates a parallel branch of the tree instead, which
 * is the documented way to keep a segment out of a layout: the URLs stay exactly
 * `/mockup/auth/*` and `/mockup/quiz`, but this branch never mounts the shell.
 */
export const metadata: Metadata = {
  title: {
    default: "Rubrix UI mockups",
    template: "%s · Rubrix mockups",
  },
  description:
    "Standalone UI mockups for the AI assessment platform. Static only: no backend, no database, no authentication.",
}

export default function StandaloneMockupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        Pre-paint theme bootstrap, the same one the shell uses, so these screens
        honour the stored light/dark preference and Tailwind's `.dark`
        utility variants agree with the token block in globals.css.
      */}
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      {children}
    </>
  )
}
