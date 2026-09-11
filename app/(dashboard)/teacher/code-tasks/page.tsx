import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherCodeTasks } from "@/components/teacher-code-tasks"
import { getSessionUser } from "@/lib/auth"
import { listTeacherCodeTasks } from "@/lib/code-eval"

export const dynamic = "force-dynamic"

export default async function TeacherCodeTasksPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const tasks = await listTeacherCodeTasks(user)

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Code tasks"
        description="Author sandboxed code assessments, generate draft test cases, review per-test evidence, and scan the cohort for suspiciously similar submissions."
      >
        <TeacherCodeTasks initialTasks={tasks} />
      </RolePageShell>
    </RoleGuard>
  )
}
