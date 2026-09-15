import Link from "next/link"

import { BRAND } from "@/components/shell/nav-config"

/**
 * Centred frame for the standalone auth screens.
 *
 * One `<main>` landmark, the brand block, and a single card-width column. The
 * card itself belongs to each page, so sign-in and register can carry their own
 * headings and footers without nesting frames.
 */
export default function MockupAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-foreground sm:px-6">
      <Link
        href={BRAND.indexHref}
        className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BRAND.icon className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm leading-none font-semibold tracking-tight">
            {BRAND.name}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{BRAND.tagline}</span>
        </span>
      </Link>

      <main className="w-full max-w-md">{children}</main>

      <p className="text-center text-xs text-muted-foreground">
        Mockup only — no credentials are checked and nothing is sent anywhere.
      </p>
    </div>
  )
}
