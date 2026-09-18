import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentMarksView } from "@/components/student-marks-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentAssessments } from "@/lib/student-assessments"
import { listStudentCourseOutcomes } from "@/lib/student-course-outcome"
import { buildCurrentTermMarks, buildStudentGrades } from "@/lib/student-grades"
import { arrearEntries } from "@/lib/student-outcome-view"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Marks" }

/**
 * Marks — the current term.
 *
 * The everyday "how am I doing now" page, split out of the old combined grades page.
 * It reads the current period's released marks through the same reader the assessments
 * hub uses (`listStudentAssessments`), so it cannot disagree with the hub about which
 * marks exist or which are released, and groups them with the same pure module the
 * course hub uses (`buildStudentGrades`), so a subject's marks and average are one
 * computation rather than two.
 *
 * The outcome reader is a second, independent read, used only to surface outstanding
 * arrears — the one thing from a *completed* course that belongs on the current-standing
 * page. It never contributes marks here.
 *
 * Server component. Being current-term-only is the whole point of the split: prior and
 * completed courses are on `/student/grades`, so the same rows never have two homes.
 */
export default async function StudentMarksPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const [payload, outcomes] = await Promise.all([
    listStudentAssessments(user),
    listStudentCourseOutcomes(user),
  ])
  if (payload === null) redirect("/login")

  const marks = buildCurrentTermMarks(buildStudentGrades(payload.assessments))
  const arrears = arrearEntries(outcomes)

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
          title="Marks"
          description="Released marks for your current term, by subject. A mark appears here only once it has been released."
        />
        <StudentMarksView marks={marks} arrears={arrears} />
      </AppShell>
    </RoleGuard>
  )
}
