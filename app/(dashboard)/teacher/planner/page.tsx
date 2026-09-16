import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherPlannerView } from "@/components/teacher-planner-view"
import { getSessionUser } from "@/lib/auth"
import { listTeacherCalendar } from "@/lib/calendar"
import { nextUpcoming } from "@/lib/calendar-view"
import { listAssessmentDeadlinesForTeacher } from "@/lib/teacher-planner"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Planner" }

/**
 * Planner.
 *
 * Two readers, because a deadline is not a calendar event: `listTeacherCalendar`
 * gives the teaching calendar (already scoped to this teacher's offerings and their
 * own assessments), and `listAssessmentDeadlinesForTeacher` gives the deadlines with
 * the facts a calendar row cannot carry — marks, submission counts and release
 * state.
 *
 * Both are read on the server. `upcoming` is computed here too, against the server's
 * clock, so the panel cannot disagree with itself after hydration.
 *
 * A teacher sees **unreleased** assessments here; a student does not see them at
 * all. That asymmetry is the point of the release concept, and it lives in the two
 * readers rather than in this page.
 */
export default async function TeacherPlannerPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const [events, deadlines] = await Promise.all([
    listTeacherCalendar(user),
    listAssessmentDeadlinesForTeacher(user),
  ])
  const upcoming = nextUpcoming(events, new Date())

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
          title="Planner"
          description="Your teaching calendar and the assessment deadlines you own."
        />
        <TeacherPlannerView events={events} deadlines={deadlines} upcoming={upcoming} />
      </AppShell>
    </RoleGuard>
  )
}
