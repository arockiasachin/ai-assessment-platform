import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { StudentCodeSubmissions } from "@/components/student-code-submissions"
import { getSessionUser } from "@/lib/auth"
import { listStudentCodeTasks } from "@/lib/code-eval"

export const dynamic = "force-dynamic"

export default async function StudentCodeSubmissionsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const tasks = await listStudentCodeTasks(user)

  return (
    <RoleGuard role="student">
      <RolePageShell
        role="student"
        title="Code submissions"
        description="Submit code for sandboxed evaluation. You get per-test pass/fail with output; results are evidence for your teacher and never publish a grade directly."
      >
        <StudentCodeSubmissions initialTasks={tasks} />
      </RolePageShell>
    </RoleGuard>
  )
}
