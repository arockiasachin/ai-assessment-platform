import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherObservabilityView } from "@/components/teacher-observability-view"
import { listTeacherOfferingsForAnalytics } from "@/lib/analytics/service"
import { getSessionUser } from "@/lib/auth"
import { getRecentGradeActivityForTeacher } from "@/lib/observability/audit-view"
import { listGradingDecisionsForTeacher } from "@/lib/observability/grading-decisions"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Activity log" }

/**
 * Activity log.
 *
 * The audit trail behind the grade pipeline for one owned offering, plus the marks
 * teachers changed rather than accepted. Both readers scope to the caller's own
 * offering, so the page cannot show another teacher's rows.
 *
 * The route stays `/teacher/observability` (and the nav links here) while the page is
 * titled "Activity log", which is what the nav already calls it — the mismatch between
 * the path and the label is deliberate and documented in `nav-config.ts`.
 *
 * This is a presentation port. The read path already existed; what changed is that it
 * now renders through the shared shell and primitives instead of the older
 * `RolePageShell`, the activity list names its actors, and the grading-decisions table
 * is new. Three behaviours were deliberately **not** carried over from the mockup:
 * an "Export log" button with no write path, a date-range filter over an already
 * truncated window, and `toLocaleString()` in render (an implicit-locale hydration
 * hazard — dates now go through `formatDateTime`).
 */
const ACTIVITY_PAGE_SIZE = 25

export default async function TeacherObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const requested = typeof params.offeringId === "string" ? params.offeringId : null
  // A non-numeric, zero or negative page falls back to the first page rather
  // than erroring: the param is a view detail, not a resource identifier.
  const requestedPage = Number.parseInt(typeof params.page === "string" ? params.page : "1", 10)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const offerings = await listTeacherOfferingsForAnalytics(user)
  const selected = offerings.find((offering) => offering.id === requested) ?? offerings[0] ?? null

  const [activity, decisions] = selected
    ? await Promise.all([
        getRecentGradeActivityForTeacher(user, {
          offeringId: selected.id,
          limit: ACTIVITY_PAGE_SIZE,
          offset: (page - 1) * ACTIVITY_PAGE_SIZE,
        }),
        listGradingDecisionsForTeacher(user, selected.id),
      ])
    : [null, null]

  const pageCount = activity ? Math.max(1, Math.ceil(activity.total / ACTIVITY_PAGE_SIZE)) : 1
  const pageHref = (target: number): string => {
    const query = new URLSearchParams()
    if (selected) query.set("offeringId", selected.id)
    if (target > 1) query.set("page", String(target))
    const search = query.toString()
    return search ? `/teacher/observability?${search}` : "/teacher/observability"
  }

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          eyebrow={selected ? `${selected.courseCode} · audit trail` : "Audit trail"}
          title="Activity log"
          description="Recent grade-pipeline activity — AI suggestions, review decisions, and published grades — plus every mark a teacher changed. Read-only."
        />

        {offerings.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            You have no offerings yet, so there is no activity to show.
          </p>
        ) : (
          <div className="space-y-6">
            {/* The offering selector is kept from the previous page: the readers are
                per-offering, so without it a teacher with two offerings could only
                ever see the first. It is a real control, not a mockup affordance. */}
            <nav aria-label="Offering" className="flex flex-wrap gap-2">
              {offerings.map((offering) => {
                const isActive = offering.id === selected?.id
                return (
                  <Link
                    key={offering.id}
                    href={`/teacher/observability?offeringId=${offering.id}`}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                      "focus-visible:ring-3 focus-visible:ring-ring/50",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background hover:bg-muted",
                    ].join(" ")}
                  >
                    {offering.courseCode} · {offering.term} {offering.academicYear}
                  </Link>
                )
              })}
            </nav>

            {activity && decisions ? (
              <>
                <TeacherObservabilityView
                  activity={activity.items}
                  decisions={decisions.items}
                  total={activity.total}
                  page={page}
                  pageSize={ACTIVITY_PAGE_SIZE}
                />
                {pageCount > 1 && (
                  <nav
                    aria-label="Activity pages"
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <p className="text-xs text-muted-foreground">
                      Page {page} of {pageCount} · {activity.total} activity{" "}
                      {activity.total === 1 ? "entry" : "entries"} in this offering.
                    </p>
                    <div className="flex items-center gap-2">
                      {page > 1 ? (
                        <Link
                          href={pageHref(page - 1)}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Previous
                        </Link>
                      ) : (
                        <span className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
                          Previous
                        </span>
                      )}
                      {page < pageCount ? (
                        <Link
                          href={pageHref(page + 1)}
                          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Next
                        </Link>
                      ) : (
                        <span className="rounded-lg border border-border/50 px-3 py-1.5 text-xs text-muted-foreground">
                          Next
                        </span>
                      )}
                    </div>
                  </nav>
                )}
              </>
            ) : null}
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}
