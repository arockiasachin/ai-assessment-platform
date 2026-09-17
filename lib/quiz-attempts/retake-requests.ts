import "server-only"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveStudentProfileId, teacherOwnsAssessment } from "./authz"
import { QuizAttemptError } from "./errors"

/**
 * Retake requests: a student asks, a teacher decides.
 *
 * ## Why a record and not a flag
 *
 * An approval is a teacher action on a student's record, so it carries who decided it and when
 * and it writes an `AuditLog` row — the same treatment as every other high-trust mutation here.
 * The shape mirrors `GradeReview`, the closest existing pending→decision record, rather than
 * inventing a second pattern for the same idea.
 *
 * ## One row per student per assessment
 *
 * `@@unique([assessmentId, studentId])`. A rejection does **not** delete the row: the student
 * asks again by reverting it to `PENDING`, which keeps the whole exchange on one record instead
 * of accumulating rejected rows that then have to be ordered to find the current state. The
 * audit log keeps the history regardless.
 *
 * ## What a request does not do
 *
 * It does not grant a sitting, change an attempt count, or touch a mark. It records an
 * intention and a decision; `startQuizAttempt` reads the APPROVED status and decides separately,
 * so the two cannot drift into disagreeing about whether a student may sit.
 */

export type RetakeRequestView = {
  id: string
  assessmentId: string
  studentId: string
  status: "PENDING" | "APPROVED" | "REJECTED"
  requestNote: string | null
  decisionNote: string | null
  decidedAt: string | null
  decidedBy: string | null
  createdAt: string
}

function serialize(row: {
  id: string
  assessmentId: string
  studentId: string
  status: string
  requestNote: string | null
  decisionNote: string | null
  decidedAt: Date | null
  decidedBy: { fullName: string } | null
  createdAt: Date
}): RetakeRequestView {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    studentId: row.studentId,
    status: row.status as RetakeRequestView["status"],
    requestNote: row.requestNote,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    // The decider's *name*, not their id: a student asking "who decided" should get an answer.
    // `AuditLog` deliberately keeps ids so it survives deletion, but this is a live view.
    decidedBy: row.decidedBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

const requestSelect = {
  id: true,
  assessmentId: true,
  studentId: true,
  status: true,
  requestNote: true,
  decisionNote: true,
  decidedAt: true,
  decidedBy: { select: { fullName: true } },
  createdAt: true,
} as const

/**
 * A student asks for a retake.
 *
 * Idempotent by intent: asking twice while a request is `PENDING` returns the existing row
 * rather than erroring, because a double click on a "Request retake" button is not a mistake
 * worth surfacing. Asking again after a **rejection** reverts the row to `PENDING` and clears
 * the previous decision, so the teacher sees a fresh request rather than a stale decision.
 *
 * Refuses when the assessment is not on the `APPROVAL` policy: on `FIXED` the student can
 * already sit, and on `NONE` a request would only create a queue of things nobody may grant.
 */
export async function requestRetake(
  user: AuthUser,
  assessmentId: string,
  input: { note: string | null } = { note: null },
): Promise<RetakeRequestView> {
  const studentId = await resolveStudentProfileId(user)

  // Release governs use (SN-5). Filing a retake request against an assessment the student cannot
  // see is the same defect as submitting to one, so the predicate is folded into the lookup and
  // an unreleased assessment is refused exactly as a nonexistent one.
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, ...releasedAssessmentWhere() },
    select: {
      id: true,
      retakePolicy: true,
      offering: {
        select: { enrollments: { where: { studentId, status: "active" }, select: { id: true } } },
      },
    },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")
  if (assessment.offering.enrollments.length === 0) {
    throw new QuizAttemptError(403, "You are not enrolled in this assessment offering.")
  }
  if (assessment.retakePolicy !== "APPROVAL") {
    throw new QuizAttemptError(
      409,
      "This assessment does not take retake requests; the attempt limit decides.",
    )
  }

  const existing = await prisma.retakeRequest.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId } },
    select: { id: true, status: true },
  })

  if (existing?.status === "APPROVED") {
    // Already granted — asking again would only risk superseding a decision that stands.
    const row = await prisma.retakeRequest.findUniqueOrThrow({
      where: { id: existing.id },
      select: requestSelect,
    })
    return serialize(row)
  }

  const row = await prisma.$transaction(async (tx) => {
    // A **deliberate full write**, not a partial update: re-asking resets the row, so the
    // decision columns are cleared to null on purpose rather than left alone. `requestNote` is
    // `string | null` at this boundary (the route normalises an omitted note to null), which is
    // what keeps `?? null` off a request-derived field — the shape
    // `eslint-rules/no-unguarded-partial-write.mjs` exists to catch.
    const written =
      existing === null
        ? await tx.retakeRequest.create({
            data: { assessmentId, studentId, requestNote: input.note },
            select: requestSelect,
          })
        : await tx.retakeRequest.update({
            where: { id: existing.id },
            data: {
              status: "PENDING",
              requestNote: input.note,
              // A re-ask clears the previous decision, so nobody reads a stale rejection as
              // applying to the new request.
              decidedAt: null,
              decidedById: null,
              decisionNote: null,
            },
            select: requestSelect,
          })

    await writeAuditLog(tx, {
      entityType: "RetakeRequest",
      entityId: written.id,
      action: "retake.requested",
      actor: { id: user.id, role: user.role },
      after: { assessmentId, status: "PENDING" },
    })

    return written
  })

  return serialize(row)
}

/**
 * A teacher approves or rejects a request.
 *
 * Only for an assessment they own. The audit row records the decision *and* the fact that it is
 * a decision, because "the request exists" and "someone granted it" are different facts and only
 * the second one lets a student sit.
 */
export async function decideRetakeRequest(
  user: AuthUser,
  assessmentId: string,
  studentId: string,
  decision: { approve: boolean; note: string | null },
): Promise<RetakeRequestView> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new QuizAttemptError(403, "Teacher profile not found.")
  if (!teacherOwnsAssessment(assessment, staff.id)) {
    throw new QuizAttemptError(403, "Forbidden")
  }

  const existing = await prisma.retakeRequest.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId } },
    select: { id: true, status: true },
  })
  if (!existing) throw new QuizAttemptError(404, "No retake request for this student.")

  const row = await prisma.$transaction(async (tx) => {
    const written = await tx.retakeRequest.update({
      where: { id: existing.id },
      data: {
        status: decision.approve ? "APPROVED" : "REJECTED",
        decidedById: staff.id,
        decidedAt: new Date(),
        decisionNote: decision.note,
      },
      select: requestSelect,
    })

    await writeAuditLog(tx, {
      entityType: "RetakeRequest",
      entityId: written.id,
      action: decision.approve ? "retake.approved" : "retake.rejected",
      actor: { id: user.id, role: user.role },
      before: { status: existing.status },
      after: { status: written.status },
    })

    return written
  })

  return serialize(row)
}

/**
 * The requests awaiting a decision for one assessment.
 *
 * Teacher-scoped by ownership. Ordered oldest-first so the queue is worked in the order students
 * asked, which is the least arbitrary rule available.
 */
export async function listRetakeRequestsForTeacher(
  user: AuthUser,
  assessmentId: string,
): Promise<RetakeRequestView[]> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, createdById: true, offering: { select: { teacherId: true } } },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")

  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff || !teacherOwnsAssessment(assessment, staff.id)) {
    throw new QuizAttemptError(403, "Forbidden")
  }

  const rows = await prisma.retakeRequest.findMany({
    where: { assessmentId },
    orderBy: { createdAt: "asc" },
    select: requestSelect,
  })

  return rows.map(serialize)
}

/** A student's own request for one assessment, or `null` if they have not asked. */
export async function getMyRetakeRequest(
  user: AuthUser,
  assessmentId: string,
): Promise<RetakeRequestView | null> {
  const studentId = await resolveStudentProfileId(user)
  const row = await prisma.retakeRequest.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId } },
    select: requestSelect,
  })
  return row ? serialize(row) : null
}
