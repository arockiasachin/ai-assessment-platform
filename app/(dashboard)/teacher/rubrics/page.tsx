import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherRubricEditor } from "@/components/teacher-rubric-editor"
import { TeacherRubricSummary } from "@/components/teacher-rubric-summary"
import { getSessionUser } from "@/lib/auth"
import { listRubricsForTeacher } from "@/lib/rubric-grading"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Rubrics" }

/**
 * Rubrics.
 *
 * A **merge**: the mockup screen is a read-only report and this page is an
 * authoring form, so the read-only summary is shown alongside the editor rather
 * than instead of it. Replacing the editor would have removed rubric authoring
 * entirely (`docs/plans/wave-1.md` §5).
 */
export default async function TeacherRubricsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const assessments = await listRubricsForTeacher(user)

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
          eyebrow="Grading"
          title="Rubrics"
          description="Review the rubric the model scores against, then edit criteria and their point ceilings below."
        />
        <div className="space-y-6">
          <TeacherRubricSummary assessments={assessments} />
          <TeacherRubricEditor initialAssessments={assessments} />
        </div>
      </AppShell>
    </RoleGuard>
  )
}
