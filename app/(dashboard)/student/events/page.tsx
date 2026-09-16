import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentEventsView } from "@/components/student-events-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentCalendar } from "@/lib/calendar"
import { nextUpcoming } from "@/lib/calendar-view"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Events" }

/**
 * Events.
 *
 * Server-fetched from `lib/calendar.ts` — a reader written for this page rather than
 * the dashboard's existing calendar query, which filters `isUpcoming: true`, projects
 * away `location` and `courseCode`, and synthesises assessment events. Reusing it
 * would have made "the calendar" mean something different from what is drawn.
 *
 * The release rule is already applied by the reader: an event hanging off an
 * assessment a teacher has not released is not in this list, while the teacher still
 * sees it on their own planner.
 *
 * `upcoming` is computed here, against the server's clock, and passed down as a
 * prop. Computing it in the client would re-evaluate `new Date()` during hydration
 * and could disagree with the server's render about an event starting in the next
 * second.
 */
export default async function StudentEventsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const events = await listStudentCalendar(user)
  const upcoming = nextUpcoming(events, new Date())

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
          title="Events"
          description="Classes, deadlines, and reminders for the courses you are enrolled in."
        />
        <StudentEventsView events={events} upcoming={upcoming} />
      </AppShell>
    </RoleGuard>
  )
}
