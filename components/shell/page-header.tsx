import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export type Breadcrumb = {
  label: string
  href?: string
}

/**
 * Page header — breadcrumbs, `h1`, description, right-aligned actions and an
 * optional in-page tab row.
 *
 * This replaces the old "title inside its own card" pattern: the title is a
 * real `<h1>` on the page background, so cards below it read as content rather
 * than as a third nested frame. Server Component by default.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  tabs,
  eyebrow,
  className,
}: {
  title: string
  description?: string
  breadcrumbs?: Breadcrumb[]
  actions?: React.ReactNode
  tabs?: React.ReactNode
  /** Small label above the title, e.g. the course code. */
  eyebrow?: string
  className?: string
}) {
  return (
    <div className={cn("mb-6 space-y-4", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow && (
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        )}
      </div>

      {tabs}
    </div>
  )
}

/** Accessible breadcrumb trail. The last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Breadcrumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className="text-foreground">
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
