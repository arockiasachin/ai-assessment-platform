import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherSubmissionsTable } from "@/components/teacher-submissions-table"
import { getSessionUser } from "@/lib/auth"
import { listSubmissionsForTeacher } from "@/lib/teacher-submissions"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Submissions" }

/**
 * The teacher's submissions queue — a read-only browse view.
 *
 * The grading editor deliberately stays where it works, inside
 * `/teacher/assignments` (`components/teacher-submissions-manager.tsx`), because
 * it is the only client of `PUT /api/teacher/assessments/submissions`. The
 * per-row action here links into it rather than replacing it. See
 * `docs/plans/wave-1.md` §D2.
 *
 * Rows are fetched on the server and passed down; the table filters them
 * locally, so there is no fetch-on-mount.
 */
export default async function TeacherSubmissionsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const rows = await listSubmissionsForTeacher(user)

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
          title="Submissions"
          description="Every submission across your offerings. A mark is only visible to a student once it has been released."
        />
        <TeacherSubmissionsTable rows={rows} />
      </AppShell>
    </RoleGuard>
  )
}
