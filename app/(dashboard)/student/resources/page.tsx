import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentResourcesView } from "@/components/student-resources-view"
import { getSessionUser } from "@/lib/auth"
import { listMaterialsForStudent } from "@/lib/materials"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Resources" }

/**
 * Resources.
 *
 * Server-fetched from `lib/materials.ts`, which is the reader S1 added: nothing
 * listed materials before this page. Rows are passed down and filtered in the
 * client, so there is no fetch-on-mount.
 *
 * The reader's scope mirrors the quiz retriever exactly — material attached to an
 * offering you are enrolled in, plus course-wide material for a course you are
 * enrolled in. That mirror is the point: if the two ever disagree, a student could
 * be quizzed on material their own page does not show.
 *
 * Ported from the mockup without `topic` or `sizeLabel` and with `state` folded
 * into `indexed` (decisions M1, M3 in `docs/plans/wave-2.md`); the view component
 * documents why each was dropped rather than substituted.
 */
export default async function StudentResourcesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const materials = await listMaterialsForStudent(user)

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
          title="Resources"
          description="Course material, transcripts, and revision collections for the courses you are enrolled in."
        />
        <StudentResourcesView materials={materials} />
      </AppShell>
    </RoleGuard>
  )
}
