import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { QuizGenerationError } from "./errors"
import { acceptsGeneratedQuestions, GENERATED_QUESTION_ASSESSMENT_TYPE } from "./metadata"

/**
 * Object-level ownership for the quiz-generation pod.
 *
 * Route handlers already enforce `requireRole("teacher")`. These helpers add
 * the second half: a teacher may only generate, read, edit, or publish against
 * an assessment they own, where ownership means "I created it" or "I teach the
 * offering it belongs to". The offering/course used for retrieval are read from
 * the owned assessment, never from the request body, so a teacher can never
 * point retrieval at someone else's material.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new QuizGenerationError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new QuizGenerationError(403, "Teacher profile not found.")
  return staff.id
}

export function teacherOwnsAssessment(
  assessment: { createdById: string; offering: { teacherId: string } | null },
  staffId: string,
): boolean {
  return assessment.createdById === staffId || assessment.offering?.teacherId === staffId
}

export type OwnedAssessment = {
  id: string
  title: string
  maxMarks: number
  courseId: string
  offeringId: string
  staffId: string
}

/**
 * Load an assessment the signed-in teacher owns, or throw 404.
 *
 * Existence and ownership answer identically (TN-69): a foreign-but-real id
 * must not be distinguishable from a nonexistent one, or a teacher could
 * enumerate other teachers' assessment ids. The read/write is still refused;
 * only the confirmation that the row exists is removed.
 */
export async function loadOwnedAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<OwnedAssessment> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      courseId: true,
      offeringId: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment || !teacherOwnsAssessment(assessment, staffId)) {
    throw new QuizGenerationError(404, "Assessment not found.")
  }
  // Generation, editing and publishing all begin here, so the kind check lives here too: a
  // generated question on a group project or a code task can never be scored (TN-40). 409 rather
  // than 403 — the teacher owns it, the request is simply not applicable to that kind.
  if (!acceptsGeneratedQuestions(assessment.type)) {
    throw new QuizGenerationError(
      409,
      `Generated questions can only be attached to a ${GENERATED_QUESTION_ASSESSMENT_TYPE} assessment.`,
    )
  }
  return {
    id: assessment.id,
    title: assessment.title,
    maxMarks: assessment.maxMarks,
    courseId: assessment.courseId,
    offeringId: assessment.offeringId,
    staffId,
  }
}
