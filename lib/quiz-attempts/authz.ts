import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { QuizAttemptError } from "./errors"

/**
 * Object-level authorization for the quiz-attempt pod.
 *
 * Route handlers already enforce `requireRole("student")` / `requireRole("teacher")`.
 * These helpers add the second half:
 *
 * - a student is always resolved from the signed session, never from the body;
 * - a student must have an active enrollment in the assessment's offering;
 * - a teacher may only read attempts for an assessment they created or whose
 *   offering they teach.
 */

export async function resolveStudentProfileId(user: AuthUser): Promise<string> {
  if (user.role !== "student") throw new QuizAttemptError(403, "Forbidden")
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!profile) throw new QuizAttemptError(403, "Student profile not found.")
  return profile.id
}

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new QuizAttemptError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new QuizAttemptError(403, "Teacher profile not found.")
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
  dueDate: Date
  offeringId: string
  staffId: string
}

/** Load an assessment the signed-in teacher owns, or throw 404/403. */
export async function loadOwnedAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<OwnedQuizAssessment> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      maxMarks: true,
      dueDate: true,
      offeringId: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")
  if (!teacherOwnsAssessment(assessment, staffId)) {
    throw new QuizAttemptError(403, "Forbidden")
  }
  return {
    id: assessment.id,
    title: assessment.title,
    maxMarks: assessment.maxMarks,
    dueDate: assessment.dueDate,
    offeringId: assessment.offeringId,
    staffId,
  }
}
