import { NextResponse } from "next/server"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { applyManualMark } from "@/lib/grading/review-service"

async function getTeacherStaffId(userId: string) {
  const staff = await prisma.staffProfile.findUnique({ where: { userId }, select: { id: true } })
  return staff?.id ?? null
}

/*
 * `GET` used to live here, returning its own projection of the submissions: the assessment kind
 * collapsed to Quiz/Assignment, and marks filtered to published-only.
 *
 * It is gone because `components/teacher-submissions-manager.tsx` — its only client — now takes its
 * rows from `listSubmissionsForTeacher` as a prop, so the page renders populated instead of fetching
 * after paint (`docs/quality/a11y-perf-audit.md`, P2). Two divergent projections of the same rows was
 * the problem; this is the half that lost.
 *
 * The editor's behaviour is unchanged: `lib/teacher-submissions-view.ts` still shows a score only
 * when it has been released, so moving to the reader did not start revealing withheld marks. The
 * difference is that the reader *also* carries the real assessment kind and a `published` flag, so
 * that distinction can be surfaced deliberately later rather than by accident.
 */

export async function PUT(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response
  const user = auth.user

  const staffId = await getTeacherStaffId(user.id)
  if (!staffId) {
    return NextResponse.json(
      { success: false, message: "Teacher profile not found" },
      { status: 404 },
    )
  }

  let body: {
    submissionId?: string
    score?: number | string | null
    feedback?: string
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 })
  }

  // Partial-update semantics (bug-fix run 3, S-1): only a field the request
  // actually carries is written. An omitted `score` must never be read as an
  // explicit `null` (which deliberately un-grades).
  const hasScore = Object.prototype.hasOwnProperty.call(body, "score")
  const hasFeedback = Object.prototype.hasOwnProperty.call(body, "feedback")

  const submissionId = String(body.submissionId ?? "").trim()
  const rawScore = body.score

  if (!submissionId) {
    return NextResponse.json(
      { success: false, message: "Submission is required." },
      { status: 400 },
    )
  }

  if (!hasScore && !hasFeedback) {
    return NextResponse.json(
      { success: false, message: "Provide a score or feedback to update." },
      { status: 400 },
    )
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      studentId: true,
      assessmentId: true,
      assessment: {
        select: {
          title: true,
          maxMarks: true,
          offering: { select: { teacherId: true } },
        },
      },
    },
  })

  if (!submission || submission.assessment.offering.teacherId !== staffId) {
    return NextResponse.json({ success: false, message: "Submission not found." }, { status: 404 })
  }

  const score =
    rawScore === null || rawScore === undefined || rawScore === "" ? null : Number(rawScore)

  if (
    hasScore &&
    score !== null &&
    (!Number.isFinite(score) || score < 0 || score > submission.assessment.maxMarks)
  ) {
    return NextResponse.json(
      { success: false, message: `Score must be between 0 and ${submission.assessment.maxMarks}.` },
      { status: 400 },
    )
  }

  await prisma.$transaction(async (tx) => {
    if (hasScore) {
      // The submission grader's score is a teacher's manual mark: publish it
      // into the audited modern pipeline (or clear+audit it on an explicit
      // `null`), never the legacy `AssessmentGrade` store.
      await applyManualMark(tx, {
        assessmentId: submission.assessmentId,
        studentId: submission.studentId,
        points: score,
        maxPoints: submission.assessment.maxMarks,
        actor: { id: user.id, role: "teacher" },
      })
    }

    const data: {
      status?: "SUBMITTED" | "GRADED"
      gradedAt?: Date | null
      gradedById?: string | null
      feedback?: string | null
    } = {}

    if (hasScore) {
      data.status = score === null ? "SUBMITTED" : "GRADED"
      data.gradedAt = score === null ? null : new Date()
      data.gradedById = score === null ? null : staffId
    }
    if (hasFeedback) {
      const feedback = String(body.feedback ?? "").trim()
      data.feedback = feedback.length ? feedback.slice(0, 1000) : null
    }

    await tx.submission.update({ where: { id: submission.id }, data })
  })

  return NextResponse.json({
    success: true,
    message: `Updated grading for ${submission.assessment.title}.`,
  })
}
