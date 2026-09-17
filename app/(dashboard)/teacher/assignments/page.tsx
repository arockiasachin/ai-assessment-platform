import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherAssessmentRegistry } from "@/components/teacher-assessment-registry"
import { TeacherAssignmentsManager } from "@/components/teacher-assignments-manager"
import { getSessionUser } from "@/lib/auth"
import { listAssessmentsForSessionUser } from "@/lib/gradebook-db"
import { listSubmissionsForTeacher } from "@/lib/teacher-submissions"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Assignments" }

/**
 * Assignments — manual creation and JSON quiz import.
 *
 * Still a client island for the write paths: `TeacherAssignmentsManager` posts to
 * `/api/gradebook/assessments` and then calls the provider's `refresh()`, which is why the seeded
 * provider in `app/(dashboard)/layout.tsx` keeps `refresh()` working rather than dropping the
 * client fetch entirely.
 */
export default async function TeacherAssignmentsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  /*
   * Fetched here rather than by the submissions queue, which used to call the canvas route in a mount
   * effect and is the P2 finding in `docs/quality/a11y-perf-audit.md`. The queue renders inside
   * `TeacherAssignmentsManager`, so its rows have to be threaded through rather than arriving as a
   * page-level payload — which is why this conversion was deferred while its sibling
   * `student/assessments` was done during the Wave 1 port.
   */
  const [submissionRows, assessmentRows] = await Promise.all([
    listSubmissionsForTeacher(user),
    listAssessmentsForSessionUser(user),
  ])

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
          title="Assignments"
          description="Create assignments manually or import quiz assessments from JSON."
        />
        <TeacherAssignmentsManager submissionRows={submissionRows} />
        <div className="mt-6">
          <TeacherAssessmentRegistry rows={assessmentRows} />
        </div>
      </AppShell>
    </RoleGuard>
  )
}
