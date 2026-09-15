import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherReviewQueue } from "@/components/teacher-review-queue"
import { getSessionUser } from "@/lib/auth"
import { listEvaluationCandidatesForTeacher, listReviewQueueForTeacher } from "@/lib/rubric-grading"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

// The root layout supplies the "· Rubrix" suffix.
export const dynamic = "force-dynamic"

// Matches the nav label ("Reviews"). The Wave 0 pilot predated this convention;
// every sibling page sets both, and the plan's §8 recommends it explicitly.
export const metadata: Metadata = { title: "Reviews" }

export default async function TeacherReviewsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const [items, candidates] = await Promise.all([
    listReviewQueueForTeacher(user),
    listEvaluationCandidatesForTeacher(user),
  ])

  return (
    <RoleGuard role="teacher">
      {/*
       * Wave 0 pilot: the first real page on the mockup shell. `scope="app"`
       * points the rail at the authenticated routes instead of `/mockup`, and
       * the identity comes from the session rather than a fixture. The `User`
       * model has no name column, so the email is the label (see
       * `lib/user-identity.ts`).
       */}
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
          title="Review queue"
          description="Inspect per-criterion AI suggestions with evidence and confidence, then accept, override, or reject. Nothing publishes without your approval."
        />
        <TeacherReviewQueue items={items} candidates={candidates} />
      </AppShell>
    </RoleGuard>
  )
}
