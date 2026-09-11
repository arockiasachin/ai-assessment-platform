import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherReviewQueue } from "@/components/teacher-review-queue"
import { getSessionUser } from "@/lib/auth"
import { listEvaluationCandidatesForTeacher, listReviewQueueForTeacher } from "@/lib/rubric-grading"

export default async function TeacherReviewsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const [items, candidates] = await Promise.all([
    listReviewQueueForTeacher(user),
    listEvaluationCandidatesForTeacher(user),
  ])

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Review queue"
        description="Inspect per-criterion AI suggestions with evidence and confidence, then accept, override, or reject. Nothing publishes without your approval."
      >
        <TeacherReviewQueue items={items} candidates={candidates} />
      </RolePageShell>
    </RoleGuard>
  )
}
