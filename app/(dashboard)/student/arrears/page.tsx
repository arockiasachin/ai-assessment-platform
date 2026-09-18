import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentArrearsView } from "@/components/student-arrears-view"
import { getSessionUser } from "@/lib/auth"
import { listStudentCourseOutcomes } from "@/lib/student-course-outcome"
import { arrearEntries } from "@/lib/student-outcome-view"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Arrears" }

/**
 * Arrears — the outstanding list.
 *
 * One row per course the arrear rule flagged, naming the course, the reason (`failed` or
 * `did-not-appear`) and the term. The reader is the same outcome reader Grades uses, and
 * the reason is its `arrear` field — the page never derives an arrear from a `not-judged`
 * verdict, because "the evidence is incomplete" is deliberately distinct from "failed".
 *
 * A summary of the same list is also surfaced on `/student/marks`, the everyday page a
 * student opens to check their standing, so an outstanding arrear is visible without
 * knowing this route exists. The full explanation lives here, including when the list is
 * empty: a student who has never incurred one should still learn what it means.
 */
export default async function StudentArrearsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const outcomes = await listStudentCourseOutcomes(user)
  const arrears = arrearEntries(outcomes)

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
          title="Arrears"
          description="Courses you have finished without passing, and what each one is waiting on."
        />
        <StudentArrearsView arrears={arrears} />
      </AppShell>
    </RoleGuard>
  )
}
