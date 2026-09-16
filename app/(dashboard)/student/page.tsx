import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { StudentDashboard } from "@/components/student-dashboard"
import { EmptyState } from "@/components/ui/empty-state"
import { getSessionUser } from "@/lib/auth"
import { listStudentCalendar } from "@/lib/calendar"
import { nextUpcoming } from "@/lib/calendar-view"
import { getPeerEvaluationWorkspaceForStudent } from "@/lib/groups"
import { listStudentAssessments } from "@/lib/student-assessments"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Dashboard" }

const HREF = "/student"

/**
 * The student dashboard, ported onto the mockup's composition.
 *
 * Three readers, all scoped to the signed-in student: their assessments, their
 * calendar (which already withholds events hanging off un-released assessments), and
 * their peer-evaluation workspace (which withholds a received aggregate until enough
 * teammates have rated). Nothing is fetched on the client, so the first render is
 * populated.
 *
 * `upcoming` is computed against the server's clock so the timeline cannot re-sort
 * itself after hydration — the same reason `/student/events` does it server-side.
 *
 * There is no eyebrow naming a course: a student takes several, and the mockup's
 * "one course" header would pick one of them without saying so. The page header
 * therefore stays on the nav description, and each section names its own source.
 */
export default async function StudentPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const [payload, calendarEvents, peerGroups] = await Promise.all([
    listStudentAssessments(user),
    listStudentCalendar(user),
    getPeerEvaluationWorkspaceForStudent(user),
  ])

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
        <PageHeader title="Dashboard" description={findNavItemByAppPath(HREF)?.item.description} />
        {payload === null ? (
          <EmptyState
            title="No student profile"
            description="Your account has no student profile, so there are no assessments or enrolments to summarise."
          />
        ) : (
          <StudentDashboard
            payload={payload}
            peerGroups={peerGroups}
            upcoming={nextUpcoming(calendarEvents, new Date(), 5)}
          />
        )}
      </AppShell>
    </RoleGuard>
  )
}
