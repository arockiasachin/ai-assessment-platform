"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import { NAV_SECTIONS, isActiveHref, type MockupRole } from "@/components/shell/nav-config"

type SideNavProps = {
  role: MockupRole
  /** Force the icon-only rail at every width (the user-facing collapse toggle). */
  collapsed?: boolean
  /**
   * `rail` participates in the responsive icon-only behaviour below `lg`;
   * `drawer` always shows labels (the mobile slide-over is already narrow but
   * has room for text).
   */
  variant?: "rail" | "drawer"
  /** Called after a link is chosen (used to close the mobile drawer). */
  onNavigate?: () => void
  className?: string
}

/**
 * Grouped left navigation.
 *
 * - Group labels are plain `<p>`s, not headings. The rail is the first thing in
 *   the document, so an `<h2>` here would put a level-2 heading *before* the
 *   page `<h1>` on all 38 mockup routes and break the heading outline; each list
 *   is still named by its label through `aria-labelledby`, so nothing is lost
 *   for assistive tech.
 * - The active row carries `aria-current="page"` plus a non-colour cue (a left
 *   accent bar and a weight change) so it does not rely on hue alone.
 * - When icon-only, labels stay in the DOM as `sr-only` text (the accessible
 *   name survives) and `title` provides the visual tooltip.
 */
export function SideNav({
  role,
  collapsed = false,
  variant = "rail",
  onNavigate,
  className,
}: SideNavProps) {
  const pathname = usePathname()
  const responsive = variant === "rail"

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-5", className)}>
      {NAV_SECTIONS[role].map((section) => {
        const headingId = `nav-${role}-${section.id}`
        return (
          <div key={section.id}>
            <p
              id={headingId}
              className={cn(
                "px-2.5 pb-1.5 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase",
                collapsed ? "sr-only" : responsive ? "sr-only lg:not-sr-only" : null,
              )}
            >
              {section.heading}
            </p>
            <ul aria-labelledby={headingId} className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon
                const active = isActiveHref(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      title={item.label}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors outline-none",
                        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
                        active
                          ? "bg-primary/10 font-medium text-primary before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        collapsed
                          ? "justify-center px-0"
                          : responsive
                            ? "md:justify-center md:px-0 lg:justify-start lg:px-2.5"
                            : "px-2.5",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span
                        className={cn(
                          "truncate",
                          collapsed ? "sr-only" : responsive ? "sr-only lg:not-sr-only" : null,
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
