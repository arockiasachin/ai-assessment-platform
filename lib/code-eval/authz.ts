import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { CodeEvalError } from "./errors"
import { resolveMaxSubmissions } from "./metadata"

/**
 * Object-level ownership for the code-evaluation pod.
 *
 * Route handlers already enforce `requireRole(...)`. These helpers add the
 * second half:
 *
 *  - a teacher may only author, read, or review a `CodeTask` whose assessment
 *    they created or teach;
 *  - a student may only submit to, and read runs for, a code task on an offering
 *    they are actively enrolled in, and only ever sees their **own** runs.
 *
 * The offering/course/language used by execution are read from the owned
 * database rows, never from the request body.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new CodeEvalError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new CodeEvalError(403, "Teacher profile not found.")
  return staff.id
}

export function teacherOwnsAssessment(
  assessment: { createdById: string; offering: { teacherId: string } | null },
  staffId: string,
): boolean {
  return assessment.createdById === staffId || assessment.offering?.teacherId === staffId
}

export type OwnedCodeAssessment = {
  id: string
  title: string
  type: string
  maxMarks: number
  dueDate: Date
  courseId: string
  offeringId: string
  staffId: string
}

/** Load an assessment the signed-in teacher owns, or throw 404/403. */
export async function loadOwnedAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<OwnedCodeAssessment> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      dueDate: true,
      courseId: true,
      offeringId: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new CodeEvalError(404, "Assessment not found.")
  if (!teacherOwnsAssessment(assessment, staffId)) {
    throw new CodeEvalError(403, "Forbidden")
  }
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    maxMarks: assessment.maxMarks,
    dueDate: assessment.dueDate,
    courseId: assessment.courseId,
    offeringId: assessment.offeringId,
    staffId,
  }
}

/** Load an owned assessment that actually has a code task, or throw 404. */
export async function loadOwnedCodeTask(user: AuthUser, assessmentId: string) {
  const owned = await loadOwnedAssessment(user, assessmentId)
  const codeTask = await prisma.codeTask.findUnique({ where: { assessmentId } })
  if (!codeTask) throw new CodeEvalError(404, "This assessment has no code task.")
  return { owned, codeTask }
}

export async function resolveStudentProfileId(user: AuthUser): Promise<string> {
  if (user.role !== "student") throw new CodeEvalError(403, "Forbidden")
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) throw new CodeEvalError(403, "Student profile not found.")
  return student.id
}

export type EnrolledCodeTask = {
  assessmentId: string
  assessmentTitle: string
  dueDate: Date
  offeringId: string
  studentId: string
  codeTaskId: string
  language: string
  instructions: string | null
  starterCode: string | null
  timeLimitMs: number
  memoryLimitMb: number
  maxSubmissions: number
  metadata: unknown
}

/**
 * Load a CODE assessment the student is actively enrolled in, together with its
 * code task, or throw 403/404. Enrollment is verified here, not in the client.
 */
export async function loadEnrolledCodeTask(
  user: AuthUser,
  assessmentId: string,
): Promise<EnrolledCodeTask> {
  const studentId = await resolveStudentProfileId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      dueDate: true,
      offeringId: true,
      offering: {
        select: {
          enrollments: {
            where: { studentId, status: "active" },
            select: { id: true },
            take: 1,
          },
        },
      },
      codeTask: true,
    },
  })
  if (!assessment) throw new CodeEvalError(404, "Assessment not found.")
  if (assessment.offering.enrollments.length === 0) {
    throw new CodeEvalError(403, "You are not enrolled in this assessment offering.")
  }
  if (assessment.type !== "CODE") {
    throw new CodeEvalError(409, "This assessment is not a code assessment.")
  }
  if (!assessment.codeTask) {
    throw new CodeEvalError(404, "This assessment has no code task.")
  }
  const task = assessment.codeTask
  return {
    assessmentId: assessment.id,
    assessmentTitle: assessment.title,
    dueDate: assessment.dueDate,
    offeringId: assessment.offeringId,
    studentId,
    codeTaskId: task.id,
    language: task.language,
    instructions: task.instructions,
    starterCode: task.starterCode,
    timeLimitMs: task.timeLimitMs,
    memoryLimitMb: task.memoryLimitMb,
    maxSubmissions: resolveMaxSubmissions(task.metadata),
    metadata: task.metadata,
  }
}
