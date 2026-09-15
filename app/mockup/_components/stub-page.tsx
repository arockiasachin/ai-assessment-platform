import Link from "next/link"
import { ArrowLeft, Hammer, ListChecks } from "lucide-react"

import { BRAND, ROLE_META, findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { getPageGuide } from "../_lib/page-guide"

/**
 * Shared body for every mockup stub.
 *
 * A stub exists to (a) reserve the real route so navigation works today, and
 * (b) put the build convention on screen next to the page it applies to. The
 * page-agent filling in a stub replaces the `EmptyState` with real sections,
 * keeps the `PageHeader`, and deletes the "Build guide" card.
 *
 * Server Component — it renders from static config only.
 */
export function StubPage({ href }: { href: string }) {
  const entry = findNavItem(href)
  const guide = getPageGuide(href)

  const title = entry?.item.label ?? "Mockup page"
  const description = entry?.item.description ?? "This route is reserved for a mockup."
  const roleLabel = entry ? ROLE_META[entry.role].label : "Mockup"
  const roleHome = entry ? ROLE_META[entry.role].home : BRAND.indexHref

  return (
    <>
      <PageHeader
        eyebrow={entry ? `${roleLabel} · ${entry.section.heading}` : "Mockup"}
        title={title}
        description={description}
        breadcrumbs={[
          { label: "Mockup index", href: BRAND.indexHref },
          { label: `${roleLabel} workspace`, href: roleHome },
          { label: title },
        ]}
        actions={<StatusPill status="draft" label="Stub — not built yet" />}
      />

      <EmptyState
        icon={Hammer}
        title="Content coming next"
        description={`${href} is wired into the shell and ready to be filled in. The build guide below lists the exact fixtures and primitives to use, so the three page-agents can work in parallel without guessing.`}
        action={
          <Link href={BRAND.indexHref} className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to the mockup index
          </Link>
        }
        hint="Mockups only — no backend, no database, no authentication."
        className="bg-card"
      />

      <div className="mt-6">
        <SectionCard
          title="Build guide"
          description="Follow this literally, then delete this card. Full conventions: docs/ui/design-system.md."
          action={<ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <GuideList heading="Fixtures to import" items={guide.fixtures} source="@/lib/mock" />
            <GuideList
              heading="Primitives to compose"
              items={guide.primitives}
              source="@/components/ui/* or @/components/shell"
            />
          </div>
          <div className="mt-6">
            <GuideList heading="Section order" items={guide.structure} ordered />
          </div>
          {guide.notes && guide.notes.length > 0 && (
            <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-3 dark:bg-warning/15">
              <h3 className="text-sm font-semibold text-warning-foreground dark:text-warning">
                Must honour
              </h3>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-warning-foreground dark:text-warning">
                {guide.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}

function GuideList({
  heading,
  items,
  source,
  ordered = false,
}: {
  heading: string
  items: string[]
  source?: string
  ordered?: boolean
}) {
  const List = ordered ? "ol" : "ul"
  return (
    <div>
      <h3 className="text-sm font-medium">{heading}</h3>
      {source && <p className="mt-0.5 text-xs text-muted-foreground">from {source}</p>}
      <List
        className={
          ordered
            ? "mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground"
            : "mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground"
        }
      >
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </List>
    </div>
  )
}
