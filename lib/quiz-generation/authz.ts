import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { QuizGenerationError } from "./errors"

/**
 * Object-level authorization for quiz generation.
 *
 * Role checks alone are not enough: a teacher must only ever generate, edit, or
 * publish against an assessment they own. Ownership means "I created the
 * assessment" OR "I teach the offering it belongs to" — the same rule the
 * grading pipeline and review queue use.
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

export type OwnedQuizAssessment = {
  id: string
  title: string
  maxMarks: number
  courseId: string
  offeringId: string
  staffId: string
}

/**
 * Load an assessment the teacher owns and that can hold generated quiz
 * questions. Throws 404 for a missing assessment and 403 for one they do not
 * own (so a teacher cannot probe another teacher's ids).
 */
export async function loadOwnedQuizAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<OwnedQuizAssessment> {
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
  if (!assessment) throw new QuizGenerationError(404, "Assessment not found.")
  if (!teacherOwnsAssessment(assessment, staffId)) {
    throw new QuizGenerationError(403, "Forbidden")
  }
  if (assessment.type !== "QUIZ") {
    throw new QuizGenerationError(
      409,
      "Quiz questions can only be generated for a quiz assessment.",
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
