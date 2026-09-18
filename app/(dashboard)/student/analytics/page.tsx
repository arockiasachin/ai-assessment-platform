import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { BarChart3 } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { ANALYTICS_SCOPE_NOTE, StudentAnalyticsView } from "@/components/student-analytics"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { getSessionUser } from "@/lib/auth"
import { getStudentAnalytics } from "@/lib/student-analytics"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Analytics" }

/** The route this page owns. It has no nav entry yet — a later wave adds the rail link. */
const HREF = "/student/analytics"

/**
 * Student analytics.
 *
 * Net-new: there was no route, and the page was never in the mockup tree either. It is the
 * student-facing half of the analytics machinery the teacher's dashboard already had —
 * per-assessment class averages, a cohort trend, a score distribution — plus the retake
 * module's per-topic view that the mockup carried and the app never ported.
 *
 * ## Scope
 *
 * `getStudentAnalytics` reads the caller's own live enrolments from the session and passes
 * those offering ids to the **ownership-agnostic** readers. It never calls a teacher entry
 * point, which would run `loadOwnedOffering` and throw.
 *
 * ## What it deliberately does not show
 *
 * There is no personal trend line and no personal delta, because the platform stores no
 * history of a student's own score (`lib/student-dashboard-view.ts`). The trend card is the
 * cohort's weekly mean and says so. Every section is omitted when its data does not exist
 * rather than rendering an empty frame.
 *
 * Server Component, `force-dynamic`: the page reads the signed session.
 */
export default async function StudentAnalyticsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const analytics = await getStudentAnalytics(user)

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Analytics"
          description={
            findNavItemByAppPath(HREF)?.item.description ??
            "Your own marks against your cohorts, and where each course stands."
          }
        />

        <Callout tone="info" title="Whose numbers these are" icon={BarChart3}>
          <p className="text-muted-foreground">{ANALYTICS_SCOPE_NOTE}</p>
        </Callout>

        <div className="mt-6">
          {analytics === null ? (
            <EmptyState
              icon={BarChart3}
              title="No student profile"
              description="Your account has no student profile, so there are no enrolments to analyse."
            />
          ) : (
            <StudentAnalyticsView analytics={analytics} />
          )}
        </div>
      </AppShell>
    </RoleGuard>
  )
}
