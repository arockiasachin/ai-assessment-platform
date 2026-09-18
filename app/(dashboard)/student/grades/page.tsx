import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentGradesView } from "@/components/student-grades-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentCourseOutcomes } from "@/lib/student-course-outcome"
import { completedCourses } from "@/lib/student-outcome-view"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Grades" }

/**
 * Grades — completed courses.
 *
 * Repurposed from the combined marks-by-subject-and-term page. The current-term section
 * moved to `/student/marks`; what remains is the transcript: for each course the student
 * has finished, the verdict `evaluateCourseOutcome` reached, the weighted grand total
 * behind it, and the term.
 *
 * The reader is `listStudentCourseOutcomes`, which is the only module that composes the
 * CAT gate, the published-only weighted total and the pass rule; this page formats its
 * output and adds no arithmetic of its own. `ended` is the completion predicate, so a
 * course still being taught never appears here — it is on Marks.
 */
export default async function StudentGradesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const outcomes = await listStudentCourseOutcomes(user)
  const completed = completedCourses(outcomes)

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
          title="Grades"
          description="Completed courses, with the final verdict and the weighted grand total behind it. Current-term marks are on the Marks page."
        />
        <StudentGradesView completed={completed} />
      </AppShell>
    </RoleGuard>
  )
}
