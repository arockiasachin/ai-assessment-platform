import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentPeerEvaluation } from "@/components/student-peer-evaluation"
import { getSessionUser } from "@/lib/auth"
import { getPeerEvaluationWorkspaceForStudent } from "@/lib/groups"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Peer evaluation" }

/**
 * Peer evaluation.
 *
 * A **merge** rather than a restyle: the mockup is a read-only report and this
 * page is the only surface where a student can submit, so the rating form is
 * preserved and the mockup's reporting cards are added around it
 * (`docs/plans/wave-1.md` §5, slice 2).
 */
export default async function StudentPeerEvaluationPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const groups = await getPeerEvaluationWorkspaceForStudent(user)

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
          title="Peer evaluation"
          description="Rate your teammates and yourself on five behaviourally-anchored dimensions. Your individual ratings stay confidential."
        />
        <StudentPeerEvaluation initialGroups={groups} />
      </AppShell>
    </RoleGuard>
  )
}
