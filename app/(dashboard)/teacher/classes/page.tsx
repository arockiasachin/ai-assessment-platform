import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherRosterTable } from "@/components/teacher-roster-table"
import { getSessionUser } from "@/lib/auth"
import { listRosterForTeacher } from "@/lib/teacher-roster"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Classes" }

/**
 * Class roster — the students in the teacher's offerings.
 *
 * The mockup design put a roster on "Classes"; the real page administered
 * offerings instead. The two were split (see `docs/plans/wave-1.md` §D1), so
 * offering configuration now lives at `/teacher/offerings` and this page is the
 * roster the design intended.
 *
 * Two of the mockup roster's six columns are deliberately absent because nothing
 * can derive them: "Last active" (no activity timestamp exists on any model) and
 * "Standing" (the real alerts are offering-level, with no per-student flag).
 * See `lib/teacher-roster.ts`.
 *
 * Rows are fetched on the server and filtered in the client, so there is no
 * fetch-on-mount.
 */
export default async function TeacherClassesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const rows = await listRosterForTeacher(user)

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
          eyebrow="Teaching"
          title="Classes"
          description="The enrolled students in your offerings, with their team, released-mark average and hand-ins. Enrollment limits and registration windows live under Offerings."
        />
        <TeacherRosterTable rows={rows} />
      </AppShell>
    </RoleGuard>
  )
}
