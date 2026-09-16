import "server-only"

import { prisma } from "@/lib/prisma"

/**
 * The acting teacher's `StaffProfile.id`, or `null` when they have no profile.
 *
 * `lib/teacher-submissions.ts` and `lib/teacher-roster.ts` share this one rather
 * than each carrying a copy. (Seven other modules still have their own, taking an
 * `AuthUser`; consolidating those is a separate change — this module exists so
 * the count at least stops growing.)
 */
export async function resolveTeacherStaffId(userId: string): Promise<string | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  return staff?.id ?? null
}

/** The fields ownership is decided from, so the rule needs no full row. */
export type AssessmentOwnership = {
  createdById: string
  offering: { teacherId: string } | null
}

/**
 * Whether a teacher owns an assessment: they created it, or they teach its
 * offering.
 *
 * **This is the fifth copy of this rule, and that is the point of putting it
 * here.** The same function already exists, byte-for-byte identical, in
 * `lib/quiz-attempts/authz.ts`, `lib/quiz-generation/authz.ts`,
 * `lib/rubric-grading/rubric-service.ts` and `lib/code-eval/authz.ts` — each pod
 * grew its own. Adding a sixth beside them would be the wrong direction, so new
 * code imports this one.
 *
 * The four copies are **not** consolidated here: each sits behind a pod-specific
 * error type and a different `resolveTeacherStaffId`, so folding them together is
 * a change across four pods rather than a rename, and it does not belong inside a
 * feature slice. An authorization rule with five implementations is a real risk —
 * a divergence would be a silent hole, not a compile error — so the follow-up is
 * recorded in `docs/plans/wave-2.md` §6 with the exact locations.
 */
export function teacherOwnsAssessment(assessment: AssessmentOwnership, staffId: string): boolean {
  return assessment.createdById === staffId || assessment.offering?.teacherId === staffId
}
