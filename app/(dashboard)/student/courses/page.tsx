import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentCoursesView } from "@/components/student-courses-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentCourses } from "@/lib/student-courses"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Courses" }

/**
 * Courses.
 *
 * Server-fetched: the query moved into `lib/student-courses.ts` so this page
 * renders from props rather than mounting and then fetching, which was the
 * deferred P1 finding on this route. The enrolment and rating controls stay a
 * client island because they are the write paths.
 *
 * The design's course card is ported without `room` (no column exists), the
 * Materials card (nothing reads `Material`/`MaterialChunk` until Wave 2), and
 * the peer rating table — `docs/plans/wave-1.md` D7 keeps a student's view of
 * ratings aggregate-only, plus their own.
 */
export default async function StudentCoursesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const payload = await listStudentCourses(user)
  if (payload === null) redirect("/login")

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
          title="Courses"
          description="Your registrations, the courses open for registration, and the feedback you have left. A course can be rated once it has finished."
        />
        <StudentCoursesView initialPayload={payload} />
      </AppShell>
    </RoleGuard>
  )
}
