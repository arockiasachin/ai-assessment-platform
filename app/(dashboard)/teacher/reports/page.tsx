import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherRatingsReport } from "@/components/teacher-ratings-report"
import { getSessionUser } from "@/lib/auth"
import { getTeacherRatingsReport } from "@/lib/course-ratings"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Reports" }

/**
 * Course-feedback report.
 *
 * Server-fetched: the previous version loaded its own data in a client `useEffect`,
 * which is the deferred P1 fetch-on-mount finding, so this page now arrives with
 * the rows as props instead of adding another instance of it.
 *
 * The mockup's report-card table is deliberately absent — it needs per-student
 * marks across an offering, which this page has no query for yet
 * (`docs/plans/wave-1.md` §5, "ship the ratings half first"). "At risk" and
 * "Completion" are absent for the same reason.
 */
export default async function TeacherReportsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const offerings = (await getTeacherRatingsReport(user)) ?? []

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
          eyebrow="Insight"
          title="Reports"
          description="What students said about your course delivery, per offering. Ratings open once a course has finished."
        />
        <TeacherRatingsReport offerings={offerings} />
      </AppShell>
    </RoleGuard>
  )
}
