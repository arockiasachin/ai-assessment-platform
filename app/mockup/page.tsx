import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Info, Layers } from "lucide-react"

import {
  BRAND,
  MOCKUP_ROLES,
  NAV_SECTIONS,
  ROLE_META,
  allNavItems,
} from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { hasPageGuide } from "./_lib/page-guide"

export const metadata: Metadata = {
  title: "Mockup index",
}

/**
 * The mockup index — the page the owner actually reviews.
 *
 * Every route in the tree is listed here, grouped by role and then by the same
 * sections the left rail uses (one source of truth: `nav-config.ts`), so the
 * index can never drift from the navigation.
 */
export default function MockupIndexPage() {
  const totalPages = allNavItems().length

  return (
    <>
      <PageHeader
        eyebrow="Design foundation"
        title="UI mockups"
        description={`Every screen of the rebuilt interface, navigable end to end. ${totalPages} pages across three roles.`}
        breadcrumbs={[{ label: "Mockup index" }]}
        actions={<StatusPill status="draft" label="Static mockups — no backend" />}
      />

      <SectionCard
        title="How to review this"
        description="What these pages are, and what they deliberately are not."
        action={<Info className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          <li>
            <span className="font-medium text-foreground">Mockups only.</span> No database, no API
            calls, no authentication. Every number comes from typed fixtures in{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">lib/mock</code>.
          </li>
          <li>
            <span className="font-medium text-foreground">Pages are stubs.</span> Each route renders
            its final header plus the exact build guide its page-agent will follow.
          </li>
          <li>
            <span className="font-medium text-foreground">Use the left rail.</span> Navigation is
            grouped by role; the account menu switches between teacher, student and admin previews.
          </li>
          <li>
            <span className="font-medium text-foreground">Dark mode and mobile.</span> Toggle the
            theme in the top bar, or narrow the window to open the slide-over navigation.
          </li>
        </ul>
      </SectionCard>

      {MOCKUP_ROLES.map((role) => (
        <section key={role} aria-labelledby={`role-${role}`} className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
            <h2 id={`role-${role}`} className="text-lg font-semibold tracking-tight">
              {ROLE_META[role].label} workspace
            </h2>
            <p className="text-sm text-muted-foreground">{ROLE_META[role].blurb}</p>
          </div>

          <div className="space-y-6">
            {NAV_SECTIONS[role].map((section) => (
              <div key={section.id}>
                <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {section.heading}
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {item.label}
                            </span>
                            <ArrowRight
                              className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                              aria-hidden="true"
                            />
                          </span>
                          <span className="text-sm text-muted-foreground text-pretty">
                            {item.description}
                          </span>
                          <span className="mt-auto flex items-center gap-2 pt-1">
                            <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">
                              {item.href}
                            </code>
                            {!hasPageGuide(item.href) && (
                              <StatusPill status="needs-review" label="Guide missing" />
                            )}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="mt-10 flex items-center gap-2 text-xs text-muted-foreground">
        <Layers className="size-3.5" aria-hidden="true" />
        {BRAND.name} · {BRAND.tagline} · mockup build of the assessment platform UI
      </p>
    </>
  )
}
