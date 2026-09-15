import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentAssessmentsView } from "@/components/student-assessments-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentAssessments } from "@/lib/student-assessments"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Assessments" }

/**
 * Assessments.
 *
 * Server-fetched: the query moved into `lib/student-assessments.ts` so this page
 * can render from props rather than mounting and then fetching, which was the
 * deferred P1 finding on this route. The submission editor below stays a client
 * island because it is the write path.
 */
export default async function StudentAssessmentsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const payload = await listStudentAssessments(user)
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
          title="Assessments"
          description="Full assessment detail, due windows, and your coursework. A mark appears here only once it has been released."
        />
        <StudentAssessmentsView initialPayload={payload} />
      </AppShell>
    </RoleGuard>
  )
}
