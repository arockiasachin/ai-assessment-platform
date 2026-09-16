import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { TeacherDashboard } from "@/components/teacher-dashboard"
import { EmptyState } from "@/components/ui/empty-state"
import { getSessionUser } from "@/lib/auth"
import {
  getTeacherAnalyticsOverview,
  listTeacherOfferingsForAnalytics,
} from "@/lib/analytics/service"
import { listTeacherCalendar } from "@/lib/calendar"
import { nextUpcoming } from "@/lib/calendar-view"
import { listReviewQueueForTeacher } from "@/lib/rubric-grading"
import { listAssessmentDeadlinesForTeacher } from "@/lib/teacher-planner"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Dashboard" }

const HREF = "/teacher"

/**
 * The teacher dashboard, ported onto the mockup's composition.
 *
 * **Scoped to one offering, and to the first one the teacher owns.** The mockup's
 * dashboard was a single course's term at a glance; a real teacher can own several
 * offerings. The analytics page solves the same problem with a client-side selector
 * because its payload is interactive; this page is read-only, so it picks the first
 * offering and names it in the eyebrow rather than making every section's data
 * depend on a fetch the page does not do. A selector is a follow-up, not an
 * invention — nothing here displays another offering's numbers.
 *
 * **One overview read covers three sections.** `getTeacherAnalyticsOverview` already
 * embeds the at-risk roster and the weekly trend (`buildRosterForOffering`,
 * `buildTrendForOffering`), so `getAtRiskRosterForTeacher` and
 * `getCohortTrendForTeacher` are not called here — doing so would re-run the same
 * queries and open a window for the two copies to disagree.
 *
 * `upcoming` is computed against the server's clock so the timeline cannot re-sort
 * itself after hydration.
 */
export default async function TeacherPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const offerings = await listTeacherOfferingsForAnalytics(user)
  const offering = offerings[0] ?? null

  const [overview, reviewQueue, calendarEvents, deadlines] = await Promise.all([
    offering ? getTeacherAnalyticsOverview(user, { offeringId: offering.id }) : null,
    listReviewQueueForTeacher(user),
    listTeacherCalendar(user),
    listAssessmentDeadlinesForTeacher(user),
  ])

  const eyebrow = offering
    ? [offering.courseCode, offering.className, offering.term].join(" · ")
    : undefined

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
          eyebrow={eyebrow}
          title="Dashboard"
          description={findNavItemByAppPath(HREF)?.item.description}
        />
        {overview === null ? (
          <EmptyState
            title="No course offerings yet"
            description="The dashboard reports on the offerings you teach. Nothing is assigned to you this term, so there is no cohort to summarise."
          />
        ) : (
          <TeacherDashboard
            overview={overview}
            reviewQueue={reviewQueue}
            deadlines={deadlines}
            upcoming={nextUpcoming(calendarEvents, new Date(), 5)}
          />
        )}
      </AppShell>
    </RoleGuard>
  )
}
