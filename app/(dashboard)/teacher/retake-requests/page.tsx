import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherRetakeQueue } from "@/components/teacher-retake-queue"
import { getSessionUser } from "@/lib/auth"
import { listRetakeQueueForTeacher } from "@/lib/teacher-retake-requests"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Retake requests" }

/**
 * Retake requests — the teacher's decision queue (TN-51).
 *
 * The student surface could already file a request and the API could already decide one, but no
 * screen called the endpoints, so requests went unseen. This is the missing caller. Decisions go
 * through the existing per-assessment POST, which audits them, rather than a second write path.
 */
export default async function TeacherRetakeRequestsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const rows = await listRetakeQueueForTeacher(user)

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
          title="Retake requests"
          description="Students asking for another graded sitting, across every assessment you own. Approving records the decision and lets the student sit."
        />
        <TeacherRetakeQueue rows={rows} />
      </AppShell>
    </RoleGuard>
  )
}
