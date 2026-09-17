import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherReviewQueue } from "@/components/teacher-review-queue"
import { getSessionUser } from "@/lib/auth"
import { gradeReviewStatusSchema } from "@/lib/contracts/grading"
import { listEvaluationCandidatesForTeacher, listReviewQueueForTeacher } from "@/lib/rubric-grading"
import type { GradeReviewStatusValue } from "@/lib/contracts/grading"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

// The root layout supplies the "· Rubrix" suffix.
export const dynamic = "force-dynamic"

// Matches the nav label ("Reviews"). The Wave 0 pilot predated this convention;
// every sibling page sets both, and the plan's §8 recommends it explicitly.
export const metadata: Metadata = { title: "Reviews" }

/**
 * The review queue.
 *
 * The queue reads its filters from the URL rather than holding them in client
 * state, so a deep link from another surface lands on the item it named (TN-13)
 * and a decided item is reachable by its status (TN-63). `listReviewQueueForTeacher`
 * has always supported `status` and `assessmentId`; this page is the caller that
 * makes them reachable, and it adds `studentId` for the dashboard's per-row link.
 *
 * Defaults (no `status`) are the two states that actually need a human —
 * `PENDING` and `NEEDS_REVIEW`. `status=all` is the history view that makes
 * decided rows (`REJECTED`, `AUTO_ACCEPTED`, `OVERRIDDEN`) reachable, which is
 * also what enables the reopen action: a rejected suggestion only exists in the
 * queue once you ask for it.
 */
export default async function TeacherReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const rawStatus = typeof params.status === "string" ? params.status : null
  const parsedStatus =
    rawStatus && rawStatus !== "all" ? gradeReviewStatusSchema.safeParse(rawStatus) : null
  const status: GradeReviewStatusValue | "all" | undefined =
    rawStatus === "all" ? "all" : parsedStatus?.success ? parsedStatus.data : undefined
  const assessmentId = typeof params.assessmentId === "string" ? params.assessmentId : undefined
  const studentId = typeof params.studentId === "string" ? params.studentId : undefined

  const [items, candidates] = await Promise.all([
    listReviewQueueForTeacher(user, { status, assessmentId, studentId }),
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
          description="Inspect per-criterion AI suggestions with evidence and confidence, then accept, override, reject, or flag. Nothing publishes without your approval."
        />
        <TeacherReviewQueue
          items={items}
          candidates={candidates}
          activeStatus={rawStatus ?? "default"}
          filteredToStudent={studentId ?? null}
          filteredToAssessment={assessmentId ?? null}
        />
      </AppShell>
    </RoleGuard>
  )
}
