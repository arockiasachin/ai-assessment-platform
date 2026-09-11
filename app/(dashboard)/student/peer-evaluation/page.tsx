import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentPeerEvaluation } from "@/components/student-peer-evaluation"
import { getSessionUser } from "@/lib/auth"
import { getPeerEvaluationWorkspaceForStudent } from "@/lib/groups"

export const dynamic = "force-dynamic"

export default async function StudentPeerEvaluationPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const groups = await getPeerEvaluationWorkspaceForStudent(user)

  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Peer evaluation"
        description="Rate your teammates and yourself on five behaviourally-anchored dimensions. Your individual ratings stay confidential."
      >
        <StudentPeerEvaluation initialGroups={groups} />
      </RolePageShell>
    </RoleGuard>
  )
}
