import type { AIGradeSuggestion } from "@/lib/generated/prisma/client"
import type { GradeReviewStatusValue, AiGradeSuggestionResponse } from "@/lib/contracts/grading"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import type { EvaluationCandidate, ReviewQueueItem } from "./contracts"
import { RubricGradingError } from "./errors"
import { lowConfidenceReasons } from "./flagging"
import {
  readAiFlagReasons,
  serializeGrade,
  serializeReview,
  serializeRubric,
  serializeSuggestion,
} from "./serialize"
import { resolveTeacherStaffId, teacherOwnsAssessment } from "./rubric-service"
import { GRADEABLE_SUBMISSION_STATUSES } from "./submission-status"

/**
 * Teacher-scoped read models for the review queue.
 *
 * Authorization is object-level: `resolveTeacherStaffId` plus an ownership
 * filter on the assessment (creator or offering teacher). A teacher therefore
 * only ever sees their own offerings' submissions.
 */

const reviewInclude = {
  assessment: {
    select: {
      id: true,
      title: true,
      maxMarks: true,
      createdById: true,
      offering: {
        select: {
          teacherId: true,
          course: { select: { code: true, name: true } },
          classRoom: { select: { name: true, section: true } },
        },
      },
    },
  },
  student: {
    select: {
      id: true,
      fullName: true,
      registerNumber: true,
      user: { select: { email: true } },
    },
  },
  grade: true,
} as const

function ownershipFilter(staffId: string) {
  return { OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }] }
}

function classNameFor(offering: { classRoom: { name: string; section: string | null } }): string {
  return `${offering.classRoom.name}${offering.classRoom.section ? ` ${offering.classRoom.section}` : ""}`
}

/** Newest suggestion per criterion (rubric criteria first, then any label bucket). */
export function latestSuggestionsPerCriterion(
  suggestions: readonly AIGradeSuggestion[],
): AIGradeSuggestion[] {
  const seen = new Set<string>()
  const result: AIGradeSuggestion[] = []
  for (const suggestion of suggestions) {
    const key =
      suggestion.rubricCriterionId ??
      suggestion.criterionLabel ??
      suggestion.submissionId ??
      suggestion.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(suggestion)
  }
  return result
}

function buildFlags(
  review: { status: string; decisionsJson: unknown },
  suggestions: AiGradeSuggestionResponse[],
): string[] {
  const flags = readAiFlagReasons(review.decisionsJson)
  flags.push(
    ...lowConfidenceReasons(
      suggestions.map((suggestion) => ({
        criterionLabel: suggestion.criterionLabel ?? "overall",
        confidence: suggestion.confidence,
      })),
    ),
  )
  const unique = [...new Set(flags)]
  if (unique.length === 0 && review.status === "NEEDS_REVIEW") {
    return ["Flagged for teacher review."]
  }
  return unique
}

function pairKey(assessmentId: string, studentId: string): string {
  return `${assessmentId}::${studentId}`
}

export type ReviewQueueFilter = {
  /** Defaults to the two states that actually need a human. */
  status?: GradeReviewStatusValue | "all"
  assessmentId?: string
}

export async function listReviewQueueForTeacher(
  user: AuthUser,
  filter: ReviewQueueFilter = {},
): Promise<ReviewQueueItem[]> {
  const staffId = await resolveTeacherStaffId(user)

  const statuses: GradeReviewStatusValue[] | null =
    filter.status === "all" ? null : filter.status ? [filter.status] : ["PENDING", "NEEDS_REVIEW"]

  const reviews = await prisma.gradeReview.findMany({
    where: {
      assessment: {
        AND: [
          ownershipFilter(staffId),
          ...(filter.assessmentId ? [{ id: filter.assessmentId }] : []),
        ],
      },
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    include: reviewInclude,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  })

  if (reviews.length === 0) return []

  const pairs = reviews.map((review) => ({
    assessmentId: review.assessmentId,
    studentId: review.studentId,
  }))

  const [suggestions, submissions] = await Promise.all([
    prisma.aIGradeSuggestion.findMany({
      where: { OR: pairs },
      orderBy: { createdAt: "desc" },
    }),
    prisma.submission.findMany({
      where: { OR: pairs },
      select: {
        id: true,
        assessmentId: true,
        studentId: true,
        status: true,
        contentText: true,
        submittedAt: true,
      },
    }),
  ])

  const suggestionsByPair = new Map<string, AIGradeSuggestion[]>()
  for (const suggestion of suggestions) {
    const key = pairKey(suggestion.assessmentId, suggestion.studentId)
    const list = suggestionsByPair.get(key) ?? []
    list.push(suggestion)
    suggestionsByPair.set(key, list)
  }
  const submissionByPair = new Map(
    submissions.map((submission) => [
      pairKey(submission.assessmentId, submission.studentId),
      submission,
    ]),
  )

  return reviews.map((review) => {
    const key = pairKey(review.assessmentId, review.studentId)
    const submission = submissionByPair.get(key)
    const latest = latestSuggestionsPerCriterion(suggestionsByPair.get(key) ?? []).map(
      serializeSuggestion,
    )

    return {
      submission: {
        id: submission?.id ?? "",
        status: submission?.status ?? "SUBMITTED",
        contentText: submission?.contentText ?? null,
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
      },
      student: {
        id: review.student.id,
        fullName: review.student.fullName,
        registerNumber: review.student.registerNumber,
        email: review.student.user.email,
      },
      assessment: {
        id: review.assessment.id,
        title: review.assessment.title,
        maxMarks: review.assessment.maxMarks,
        courseCode: review.assessment.offering.course.code,
        courseName: review.assessment.offering.course.name,
        className: classNameFor(review.assessment.offering),
      },
      review: serializeReview(review),
      grade: review.grade ? serializeGrade(review.grade) : null,
      suggestions: latest,
      flags: buildFlags(review, latest),
    }
  })
}

export type ReviewDetail = {
  item: ReviewQueueItem
  rubric: ReturnType<typeof serializeRubric> | null
}

export async function getReviewDetailForTeacher(
  user: AuthUser,
  assessmentId: string,
  studentId: string,
): Promise<ReviewDetail> {
  const staffId = await resolveTeacherStaffId(user)

  const review = await prisma.gradeReview.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId } },
    include: {
      ...reviewInclude,
      assessment: {
        select: {
          ...reviewInclude.assessment.select,
          rubric: { include: { criteria: { orderBy: { order: "asc" } } } },
        },
      },
    },
  })
  if (!review) throw new RubricGradingError(404, "Review not found.")
  if (!teacherOwnsAssessment(review.assessment, staffId)) {
    throw new RubricGradingError(404, "Review not found.")
  }

  const [suggestions, submission] = await Promise.all([
    prisma.aIGradeSuggestion.findMany({
      where: { assessmentId, studentId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.submission.findUnique({
      where: { assessmentId_studentId: { assessmentId, studentId } },
      select: {
        id: true,
        status: true,
        contentText: true,
        submittedAt: true,
      },
    }),
  ])

  const latest = latestSuggestionsPerCriterion(suggestions).map(serializeSuggestion)

  return {
    item: {
      submission: {
        id: submission?.id ?? "",
        status: submission?.status ?? "SUBMITTED",
        contentText: submission?.contentText ?? null,
        submittedAt: submission?.submittedAt?.toISOString() ?? null,
      },
      student: {
        id: review.student.id,
        fullName: review.student.fullName,
        registerNumber: review.student.registerNumber,
        email: review.student.user.email,
      },
      assessment: {
        id: review.assessment.id,
        title: review.assessment.title,
        maxMarks: review.assessment.maxMarks,
        courseCode: review.assessment.offering.course.code,
        courseName: review.assessment.offering.course.name,
        className: classNameFor(review.assessment.offering),
      },
      review: serializeReview(review),
      grade: review.grade ? serializeGrade(review.grade) : null,
      suggestions: latest,
      flags: buildFlags(review, latest),
    },
    rubric: review.assessment.rubric ? serializeRubric(review.assessment.rubric) : null,
  }
}

/** Submissions on rubric-bearing assessments the teacher can evaluate. */
export async function listEvaluationCandidatesForTeacher(
  user: AuthUser,
): Promise<EvaluationCandidate[]> {
  const staffId = await resolveTeacherStaffId(user)

  const submissions = await prisma.submission.findMany({
    where: {
      assessment: {
        AND: [ownershipFilter(staffId), { rubric: { isNot: null } }],
      },
      // TN-35: only work the student actually handed in is a candidate. Without
      // this a `DRAFT` was offered, evaluated, and published (see
      // `./submission-status`).
      status: { in: [...GRADEABLE_SUBMISSION_STATUSES] },
    },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      assessmentId: true,
      studentId: true,
      student: { select: { id: true, fullName: true, registerNumber: true } },
      assessment: {
        select: {
          id: true,
          title: true,
          maxMarks: true,
          rubric: { select: { maxPoints: true } },
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
    take: 300,
  })

  if (submissions.length === 0) return []

  const pairs = submissions.map((submission) => ({
    assessmentId: submission.assessmentId,
    studentId: submission.studentId,
  }))

  const [suggestionGroups, reviews, grades] = await Promise.all([
    prisma.aIGradeSuggestion.groupBy({
      by: ["assessmentId", "studentId"],
      where: { OR: pairs },
      _count: { _all: true },
    }),
    prisma.gradeReview.findMany({
      where: { OR: pairs },
      select: { assessmentId: true, studentId: true, status: true },
    }),
    prisma.grade.findMany({
      where: { OR: pairs },
      select: { assessmentId: true, studentId: true, publishedAt: true },
    }),
  ])

  const suggestionKeys = new Set(
    suggestionGroups.map((group) => pairKey(group.assessmentId, group.studentId)),
  )
  const reviewStatusByPair = new Map(
    reviews.map((review) => [pairKey(review.assessmentId, review.studentId), review.status]),
  )
  const publishedKeys = new Set(
    grades
      .filter((grade) => grade.publishedAt !== null)
      .map((grade) => pairKey(grade.assessmentId, grade.studentId)),
  )

  return submissions.map((submission) => {
    const key = pairKey(submission.assessmentId, submission.studentId)
    const rubricMaxPoints = submission.assessment.rubric?.maxPoints
    return {
      submissionId: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      student: {
        id: submission.student.id,
        fullName: submission.student.fullName,
        registerNumber: submission.student.registerNumber,
      },
      assessment: {
        id: submission.assessment.id,
        title: submission.assessment.title,
        maxMarks: submission.assessment.maxMarks,
        rubricMaxPoints:
          rubricMaxPoints === null || rubricMaxPoints === undefined
            ? submission.assessment.maxMarks
            : Number(rubricMaxPoints),
      },
      hasSuggestions: suggestionKeys.has(key),
      reviewStatus: reviewStatusByPair.get(key) ?? null,
      gradePublished: publishedKeys.has(key),
    }
  })
}
