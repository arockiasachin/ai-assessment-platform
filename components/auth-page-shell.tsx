import type { ReactNode } from "react"

import { BRAND } from "@/components/shell/nav-config"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"

type AuthPageShellProps = {
  title: string
  description: string
  footer: ReactNode
  children: ReactNode
}

/**
 * Centred frame for the sign-in and register screens.
 *
 * One `<main>` landmark, the brand block, and a single card-width column. The
 * card belongs to the page, so sign-in and register carry their own headings and
 * footers without nesting frames.
 *
 * The brand block sits **outside** the card and above it: the old shell put a
 * hardcoded "G" wordmark inside the card and titled the page "Gradebook", both
 * of which were retired when the product became Rubrix. Reading the name from
 * `BRAND` means the auth screens and the app shell cannot disagree about it.
 *
 * It is deliberately **not a link**. The only sensible destination would be the
 * signed-in home, which does not exist for the anonymous visitor — the only
 * person who can see this page. (The pages previously offered a "Back to
 * dashboard" link to `/`, which redirects to `/login`: a labelled control that
 * returned the user to where they already were.)
 *
 * Deliberately no footnote either: the mockup's "no credentials are checked and
 * nothing is sent anywhere" line is false here, because these forms really do
 * authenticate.
 */
export function AuthPageShell({ title, description, footer, children }: AuthPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BRAND.icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm leading-none font-semibold tracking-tight">
            {BRAND.name}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{BRAND.tagline}</span>
        </span>
      </div>

      <main className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-1.5">
            {/* A real `<h1>`, not a styled div: this is the page's only heading. */}
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="text-sm text-muted-foreground text-pretty">{description}</p>
          </CardHeader>

          <CardContent className="space-y-5">{children}</CardContent>

          <CardFooter className="flex-col items-stretch gap-3">{footer}</CardFooter>
        </Card>
      </main>
    </div>
  )
}
