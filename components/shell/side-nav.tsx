"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  flattenNavItems,
  isActiveHref,
  navHref,
  navSectionsFor,
  resolveNavLink,
  type MockupRole,
  type NavItem,
  type NavScope,
} from "@/components/shell/nav-config"

type SideNavProps = {
  role: MockupRole
  /** Which tree the links point at. Defaults to the mockup tree. */
  scope?: NavScope
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

/** Whether any leaf under a group is the route the user is on. */
function groupHasActiveChild(item: NavItem, pathname: string, scope: NavScope): boolean {
  return flattenNavItems(item.children ?? []).some((child) => {
    const href = navHref(child.href, scope)
    return href !== null && isActiveHref(pathname, href, scope)
  })
}

/**
 * Row sizing (`px`/`justify`) for the three rail states: the forced icon-only
 * rail, the responsive md–lg icon rail, and the labelled drawer/`lg` rail.
 * Nested rows indent only where a label is visible.
 */
function rowSizing(collapsed: boolean, responsive: boolean, nested: boolean): string {
  if (collapsed) return "justify-center px-0"
  if (responsive) {
    return nested
      ? "md:justify-center md:px-0 lg:justify-start lg:pr-2.5 lg:pl-8"
      : "md:justify-center md:px-0 lg:justify-start lg:px-2.5"
  }
  return nested ? "pr-2.5 pl-8" : "px-2.5"
}

/** Visibility of a text label: hidden in the icon rail, sr-only until `lg` on the rail. */
function labelVisibility(collapsed: boolean, responsive: boolean): string | null {
  if (collapsed) return "sr-only"
  if (responsive) return "sr-only lg:not-sr-only"
  return null
}

const ROW_BASE =
  "relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"

const ROW_ACTIVE =
  "bg-primary/10 font-medium text-primary before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"

const ROW_IDLE = "text-muted-foreground hover:bg-muted hover:text-foreground"

function NavLink({
  item,
  target,
  active,
  nested,
  collapsed,
  responsive,
  onNavigate,
}: {
  item: NavItem
  /** Resolved for the current scope by the caller, query included. */
  target: { href: string; query?: Record<string, string> }
  active: boolean
  nested: boolean
  collapsed: boolean
  responsive: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={target.query ? { pathname: target.href, query: target.query } : target.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        ROW_BASE,
        active ? ROW_ACTIVE : ROW_IDLE,
        rowSizing(collapsed, responsive, nested),
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn("truncate", labelVisibility(collapsed, responsive))}>{item.label}</span>
    </Link>
  )
}

/**
 * Grouped left navigation.
 *
 * - Group labels are plain `<p>`s, not headings. The rail is the first thing in
 *   the document, so an `<h2>` here would put a level-2 heading *before* the
 *   page `<h1>` on all 38 mockup routes and break the heading outline; each list
 *   is still named by its label through `aria-labelledby`, so nothing is lost
 *   for assistive tech.
 * - A section with a **nested group** (`NavItem.children`) renders that group as
 *   a disclosure: a real `<button>` with `aria-expanded`/`aria-controls`, which
 *   is keyboard-operable by default. A flat section is untouched — every item is
 *   a leaf and renders exactly as before.
 * - The group is **auto-expanded when it contains the current route**, so a deep
 *   link is never hidden inside a collapsed group. The expanded state is derived
 *   from the pathname rather than synced in an effect (the repo lints against
 *   set-state-in-effect), and an explicit user toggle wins over the derived
 *   default.
 * - The active row carries `aria-current="page"` plus a non-colour cue (a left
 *   accent bar and a weight change) so it does not rely on hue alone. A child
 *   link that narrows a page with a query is not individually marked active —
 *   `useSearchParams` would force a Suspense boundary onto the statically
 *   rendered mockup tree — so its group carries the cue instead.
 * - When icon-only, labels stay in the DOM as `sr-only` text (the accessible
 *   name survives) and `title` provides the visual tooltip.
 */
export function SideNav({
  role,
  scope = "mockup",
  collapsed = false,
  variant = "rail",
  onNavigate,
  className,
}: SideNavProps) {
  const pathname = usePathname()
  const responsive = variant === "rail"
  const sections = navSectionsFor(role, scope)
  // Keyed by `section:item` so two groups with the same href cannot share state.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-5", className)}>
      {sections.map((section) => {
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
                const children = item.children ?? []
                if (children.length === 0) {
                  const target = resolveNavLink(item, scope)
                  if (target === null) return null
                  const active = isActiveHref(pathname, target.href, scope)
                  return (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        target={target}
                        active={active}
                        nested={false}
                        collapsed={collapsed}
                        responsive={responsive}
                        onNavigate={onNavigate}
                      />
                    </li>
                  )
                }

                const groupId = `${section.id}:${item.href}:${item.label}`
                const activeGroup = groupHasActiveChild(item, pathname, scope)
                const isOpen = openGroups[groupId] ?? activeGroup
                const panelId = `nav-group-${role}-${section.id}-${item.label.replace(/\s+/g, "-").toLowerCase()}`
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((previous) => ({
                          ...previous,
                          [groupId]: !(previous[groupId] ?? activeGroup),
                        }))
                      }
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      title={item.label}
                      className={cn(
                        ROW_BASE,
                        "w-full",
                        activeGroup ? "font-medium text-primary" : ROW_IDLE,
                        rowSizing(collapsed, responsive, false),
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      <span
                        className={cn(
                          "flex-1 truncate text-left",
                          labelVisibility(collapsed, responsive),
                        )}
                      >
                        {item.label}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 transition-transform",
                          isOpen && "rotate-180",
                          labelVisibility(collapsed, responsive),
                        )}
                      />
                    </button>
                    {isOpen && (
                      <ul id={panelId} className="mt-0.5 space-y-0.5">
                        {children.map((child) => {
                          const target = resolveNavLink(child, scope)
                          if (target === null) return null
                          // A query-narrowed child shares its path with its
                          // siblings, so pathname alone cannot say which is
                          // active; the group carries the cue for those.
                          const active = child.query
                            ? false
                            : isActiveHref(pathname, target.href, scope)
                          return (
                            <li key={`${child.href}:${child.label}`}>
                              <NavLink
                                item={child}
                                target={target}
                                active={active}
                                nested
                                collapsed={collapsed}
                                responsive={responsive}
                                onNavigate={onNavigate}
                              />
                            </li>
                          )
                        })}
                      </ul>
                    )}
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
