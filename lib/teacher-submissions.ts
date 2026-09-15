import "server-only"

import { toAssessmentScale } from "@/lib/gradebook"
import type { AssessmentKind, SubmissionState } from "@/lib/mock"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

/**
 * The teacher's submissions queue.
 *
 * This is a **server** read for the queue page. It is deliberately separate from
 * the older `GET /api/teacher/assessments/submissions` response, which exists to
 * feed an inline editor (`components/teacher-submissions-manager.tsx`) and
 * collapses the assessment kind and hides unpublished marks. The queue needs the
 * opposite of both: the real kind, and the mark whether or not it has been
 * released — "marked, withheld" is a state the count has to name.
 *
 * Ownership is the same rule as the route: only submissions whose assessment
 * belongs to the acting teacher's offering.
 */

export type TeacherSubmissionRow = {
  id: string
  studentId: string
  studentName: string
  registerNumber: string | null
  assessmentId: string
  assessmentTitle: string
  courseCode: string
  courseName: string
  className: string
  /** The real `AssessmentType`, not the route's Quiz/Assignment collapse. */
  kind: AssessmentKind
  state: SubmissionState
  dueDate: string
  submittedAt: string | null
  gradedAt: string | null
  /**
   * The mark, rescaled to the assessment's `maxMarks`, **whether or not it has
   * been released**. `null` means genuinely unmarked — never `0`, which would
   * claim the student scored nothing.
   */
  points: number | null
  maxPoints: number
  /** Whether the student can see the mark (`Grade.publishedAt !== null`). */
  published: boolean
  feedback: string | null
  versionCount: number
}

/**
 * The subset of a Prisma `submission.findMany` row this projection reads.
 *
 * Declared structurally, and typed with the same string unions as Prisma's enums
 * (`lib/mock/types.ts` mirrors them one-to-one by design), so the mapper is a
 * **pure function** that can be tested without a database.
 */
export type SubmissionQueryRow = {
  id: string
  status: SubmissionState
  submittedAt: Date | null
  gradedAt: Date | null
  feedback: string | null
  versionCount: number
  student: {
    id: string
    fullName: string
    registerNumber: string | null
  }
  assessment: {
    id: string
    title: string
    type: AssessmentKind
    dueDate: Date
    maxMarks: number
    offering: {
      classRoom: { name: string; section: string | null }
      course: { code: string; name: string }
    }
    finalGrades: Array<{
      studentId: string
      points: unknown
      maxPoints: unknown
      publishedAt: Date | null
    }>
  }
}

/** `Main Hall` + section `A` → `Main Hall A`; no section → just the room name. */
function classLabel(classRoom: { name: string; section: string | null }): string {
  return classRoom.section ? `${classRoom.name} ${classRoom.section}` : classRoom.name
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * Two invariants it must preserve:
 * - an unmarked submission yields `points: null`, never `0`;
 * - `published` is independent of `points`, because a mark can exist and be
 *   withheld, which is a state the queue has to show.
 */
export function toTeacherSubmissionRow(row: SubmissionQueryRow): TeacherSubmissionRow {
  const grade = row.assessment.finalGrades.find((item) => item.studentId === row.student.id) ?? null

  const hasMark = grade !== null && grade.points !== null && grade.maxPoints !== null
  const points = hasMark
    ? toAssessmentScale(Number(grade.points), Number(grade.maxPoints), row.assessment.maxMarks)
    : null

  return {
    id: row.id,
    studentId: row.student.id,
    studentName: row.student.fullName,
    registerNumber: row.student.registerNumber,
    assessmentId: row.assessment.id,
    assessmentTitle: row.assessment.title,
    courseCode: row.assessment.offering.course.code,
    courseName: row.assessment.offering.course.name,
    className: classLabel(row.assessment.offering.classRoom),
    kind: row.assessment.type,
    state: row.status,
    dueDate: row.assessment.dueDate.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    gradedAt: row.gradedAt?.toISOString() ?? null,
    points,
    maxPoints: row.assessment.maxMarks,
    published: grade?.publishedAt != null,
    feedback: row.feedback,
    versionCount: row.versionCount,
  }
}

/** The acting teacher's `StaffProfile.id`, or `null` when they have no profile. */
export async function resolveTeacherStaffId(userId: string): Promise<string | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  return staff?.id ?? null
}

/**
 * Every submission across the offerings this teacher owns, newest first.
 *
 * Unpublished marks are included on purpose (see `TeacherSubmissionRow.points`);
 * a student-facing read must never use this.
 */
export async function listSubmissionsForTeacher(user: AuthUser): Promise<TeacherSubmissionRow[]> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return []

  const rows = await prisma.submission.findMany({
    where: { assessment: { offering: { teacherId: staffId } } },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      gradedAt: true,
      feedback: true,
      _count: { select: { versions: true } },
      student: {
        select: { id: true, fullName: true, registerNumber: true },
      },
      assessment: {
        select: {
          id: true,
          title: true,
          type: true,
          dueDate: true,
          maxMarks: true,
          offering: {
            select: {
              classRoom: { select: { name: true, section: true } },
              course: { select: { code: true, name: true } },
            },
          },
          // Deliberately NOT filtered to published: the queue distinguishes
          // "not marked" from "marked, withheld", which needs the unpublished row.
          finalGrades: {
            select: { studentId: true, points: true, maxPoints: true, publishedAt: true },
          },
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
    take: 300,
  })

  return rows.map((row) => toTeacherSubmissionRow({ ...row, versionCount: row._count.versions }))
}
