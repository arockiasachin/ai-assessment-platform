import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { cn } from "@/lib/utils"
import { parentFor } from "@/lib/navigation"

export type BackLinkProps = {
  /**
   * The **current** route (the page rendering the link). The parent is looked up
   * from the declarative map in `lib/navigation.ts`; nothing is guessed from
   * history, so the link is deterministic and shareable.
   */
  pathname: string
  /** Override the map's label. The href still comes from the map. */
  label?: string
  /**
   * Render even when the map declares no parent, using this explicit parent.
   * Prefer extending the map; this exists for a one-off page where a declared
   * entry would be misleading.
   */
  fallback?: { label: string; href: string }
  className?: string
}

/**
 * An explicit, labelled "Back to X" link.
 *
 * A **Server Component**: it takes the page's own path as a prop rather than
 * reading `usePathname()`, so it renders on the server (the back affordance is
 * in the first paint) and needs no client boundary. The parent map is pure, so
 * the destination is unit-tested rather than eyeballed.
 *
 * Returns `null` when neither the map nor `fallback` supplies a parent — a
 * page with no declared parent shows no link, rather than a plausible-looking
 * link to the wrong place.
 */
export function BackLink({ pathname, label, fallback, className }: BackLinkProps) {
  const parent = parentFor(pathname) ?? fallback ?? null
  if (parent === null) return null

  return (
    <Link
      href={parent.href}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
        className,
      )}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      Back to {label ?? parent.label}
    </Link>
  )
}
