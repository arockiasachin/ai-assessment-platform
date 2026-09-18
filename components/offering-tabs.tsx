import Link from "next/link"

import type { AnalyticsOfferingSummary } from "@/lib/contracts/analytics"

/**
 * The offering switcher shared by the teacher's offering-scoped pages.
 *
 * Real links, not a client `Select`: the selection belongs in the URL so a
 * refresh keeps it and a deep link can target one offering (TN-14), and a
 * server-rendered control needs no client JavaScript at all. The label carries
 * the class name as well as the course code and term, because one teacher can
 * own two sections of the same course in the same term — the four DSA tabs used
 * to collapse to two identical labels (TN-16).
 *
 * The definition lives here rather than inline on each page so a fourth
 * offering-scoped page cannot grow a fifth variant of the rule.
 */
export function OfferingTabs({
  offerings,
  selectedId,
  basePath,
  label = "Offering",
  className,
}: {
  offerings: readonly AnalyticsOfferingSummary[]
  selectedId: string | null
  /** Route the links point at, e.g. `/teacher/analytics`. */
  basePath: string
  label?: string
  className?: string
}) {
  if (offerings.length === 0) return null

  return (
    <nav
      aria-label={label}
      className={["flex flex-wrap gap-2", className].filter(Boolean).join(" ")}
    >
      {offerings.map((offering) => {
        const isActive = offering.id === selectedId
        return (
          <Link
            key={offering.id}
            href={`${basePath}?offeringId=${encodeURIComponent(offering.id)}`}
            aria-current={isActive ? "page" : undefined}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-muted",
            ].join(" ")}
          >
            {offering.courseCode} · {offering.className} · {offering.term} {offering.academicYear}
          </Link>
        )
      })}
    </nav>
  )
}
