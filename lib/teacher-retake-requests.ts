import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import type { RetakeRequestView } from "@/lib/quiz-attempts/retake-requests"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * The teacher's cross-assessment retake-request queue (TN-51).
 *
 * Students could already file retake requests, and `GET`/`POST
 * /api/teacher/assessments/[assessmentId]/retake-requests` already existed — but nothing in the
 * app called them, so a request was invisible until a teacher happened to look at the right
 * assessment. This module owns the read the new queue page needs: every request across the
 * assessments the caller created or teaches, with the assessment and student named.
 *
 * It lives in its own file rather than beside `requestRetake`/`decideRetakeRequest` so the
 * student-side retake module and this teacher read do not share a write surface. The decision
 * itself still goes through the existing per-assessment endpoint and `decideRetakeRequest`.
 */
export class TeacherRetakeQueueError extends Error {
  constructor(
    readonly status: 403,
    message: string,
  ) {
    super(message)
    this.name = "TeacherRetakeQueueError"
  }
}

export type TeacherRetakeRequestRow = RetakeRequestView & {
  assessmentTitle: string
  courseCode: string
  courseName: string
  studentName: string
  registerNumber: string
}

const statusRank: Record<RetakeRequestView["status"], number> = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
}

export async function listRetakeQueueForTeacher(
  user: AuthUser,
): Promise<TeacherRetakeRequestRow[]> {
  if (user.role !== "teacher") throw new TeacherRetakeQueueError(403, "Forbidden")
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) throw new TeacherRetakeQueueError(403, "Teacher profile not found.")

  const rows = await prisma.retakeRequest.findMany({
    where: {
      assessment: {
        OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }],
      },
    },
    select: {
      id: true,
      assessmentId: true,
      studentId: true,
      status: true,
      requestNote: true,
      decisionNote: true,
      decidedAt: true,
      decidedBy: { select: { fullName: true } },
      createdAt: true,
      assessment: {
        select: {
          title: true,
          offering: { select: { course: { select: { code: true, name: true } } } },
        },
      },
      student: { select: { fullName: true, registerNumber: true } },
    },
  })

  return rows
    .map((row) => ({
      id: row.id,
      assessmentId: row.assessmentId,
      studentId: row.studentId,
      status: row.status as RetakeRequestView["status"],
      requestNote: row.requestNote,
      decisionNote: row.decisionNote,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      assessmentTitle: row.assessment.title,
      courseCode: row.assessment.offering.course.code,
      courseName: row.assessment.offering.course.name,
      studentName: row.student.fullName,
      registerNumber: row.student.registerNumber,
    }))
    .sort((a, b) => {
      if (statusRank[a.status] !== statusRank[b.status]) {
        return statusRank[a.status] - statusRank[b.status]
      }
      // Pending oldest-first (work in the order students asked); decided newest-first (a
      // decision is history, and the most recent is the one being checked).
      return a.status === "PENDING"
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt)
    })
}
