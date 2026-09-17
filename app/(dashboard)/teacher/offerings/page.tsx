import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherClassesManager } from "@/components/teacher-classes-manager"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Offerings" }

/**
 * Offering administration.
 *
 * This is the half of the old `/teacher/classes` page that manages course
 * offerings: enrollment limits, registration windows, and results publication.
 * The mockup design put a student roster on "Classes", and the real page did
 * something else entirely under the same name, so the two were split — see
 * `docs/plans/wave-1.md` §D1. This is the first page in the real app with **no
 * mockup counterpart**; its nav item carries `appOnly: true`.
 *
 * Why this page still matters even though it is undesigned: the retention-clock
 * control sets `CourseOffering.resultsPublishedAt`, which the schema calls the
 * retention anchor — the only action that starts the purge clock, and one that
 * cannot be undone. It does not release marks to students (those are published from
 * the review queue or the marks grid), which is why it is labelled "Start retention
 * clock" rather than "Publish results" (TN-68). Removing it to make room for a
 * roster would have left the retention policy with no trigger in the UI.
 *
 * `TeacherClassesManager` is a client component that fetches `/api/teacher/offerings`
 * on mount. That is the pre-existing fetch-on-mount finding
 * (`docs/quality/a11y-perf-audit.md`); converting it to server props is a
 * follow-up, not part of this move.
 */
export default async function TeacherOfferingsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

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
          title="Offerings"
          description="Enrollment limits, registration windows, and the retention clock. Starting the clock records the results-publication date for the whole cohort, begins the 15-day retention window, and cannot be undone. It does not release marks — those are published per student from the review queue or the marks grid."
        />
        <TeacherClassesManager />
      </AppShell>
    </RoleGuard>
  )
}
