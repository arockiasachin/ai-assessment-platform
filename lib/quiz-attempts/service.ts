import type { GradeResponse, GradeReviewResponse } from "@/lib/contracts/grading"
import type {
  QuizAttemptSummary,
  QuizAttemptView,
  StudentQuizSummary,
  TeacherQuizAttemptDetail,
  TeacherQuizAttemptSummary,
} from "@/lib/contracts/quiz-attempts"
import {
  QUIZ_ATTEMPT_CRITERION_LABEL,
  QUIZ_AUTO_SCORER_MODEL,
  QUIZ_SCORING_PROMPT_VERSION,
  quizAttemptStartRequestSchema,
  quizAttemptSubmitRequestSchema,
} from "@/lib/contracts/quiz-attempts"
import type { QuizAnswer } from "@/lib/contracts/quiz"
import type { Grade, GradeReview } from "@/lib/generated/prisma/client"
import { selectAdaptiveRetakeQuestions } from "@/lib/analytics/retake"
import { recordAiSuggestion, writeAuditLog } from "@/lib/grading"
import { QuizGenerationError } from "@/lib/quiz-generation/errors"
import { gradeGeneratedQuiz, type GeneratedQuestionForScoring } from "@/lib/quiz-generation/grading"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment, resolveStudentProfileId } from "./authz"
import { QuizAttemptError, QuizNotDeliverableError } from "./errors"
import { evaluateAttemptEligibility, isLateSubmission, resolveMaxAttempts } from "./eligibility"
import { quizDeliveryStatus } from "./metadata"
import {
  readOptionIds,
  serializeAttemptSummary,
  serializeStudentQuestion,
  serializeTeacherResponse,
  toNumberOrNull,
  type QuestionWithOptions,
} from "./serialize"

/**
 * Quiz-attempt persistence and grade-pipeline wiring.
 *
 * The flow is:
 *
 *   start (attempt row) -> read questions (no key) -> submit answers
 *   -> score server-side with the existing kernel -> persist QuizResponse rows
 *   -> record one deterministic `AIGradeSuggestion` (never a published Grade).
 *
 * Correctness is derived only from `QuestionOption.isCorrect` on the server, via
 * `gradeGeneratedQuiz`, the reuse point the quiz-generation pod built for exactly
 * this. A client never sends a correctness value, and the pre-submission view
 * has no answer-key field at all.
 */

const FINALIZED_STATUSES = ["SUBMITTED", "GRADED"] as const
const COUNTED_STATUSES = ["IN_PROGRESS", "SUBMITTED", "GRADED", "EXPIRED"] as const

function toScorable(questions: readonly QuestionWithOptions[]): GeneratedQuestionForScoring[] {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    explanation: question.explanation ?? null,
    options: [...question.options]
      .sort((a, b) => a.order - b.order)
      .map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
  }))
}

function assertDeliverable(questions: readonly QuestionWithOptions[]): void {
  const delivery = quizDeliveryStatus(questions)
  if (!delivery.deliverable) {
    throw new QuizNotDeliverableError(delivery.reason ?? "This quiz is not open yet.")
  }
}

async function attemptSettings(studentId: string, assessmentId: string) {
  const attempts = await prisma.quizAttempt.findMany({
    where: { assessmentId, studentId },
    select: { status: true },
  })
  const maxAttempts = resolveMaxAttempts()
  const used = attempts.filter((attempt) =>
    (COUNTED_STATUSES as readonly string[]).includes(attempt.status),
  ).length
  return {
    maxAttempts,
    attemptsUsed: used,
    attemptsRemaining: Math.max(0, maxAttempts - used),
  }
}

function toGradeResponse(grade: Grade): GradeResponse {
  return {
    id: grade.id,
    assessmentId: grade.assessmentId,
    studentId: grade.studentId,
    points: Number(grade.points),
    maxPoints: Number(grade.maxPoints),
    percentage: grade.percentage,
    source: grade.source,
    approvedById: grade.approvedById,
    overrideReason: grade.overrideReason,
    publishedAt: grade.publishedAt?.toISOString() ?? null,
    isPublished: grade.publishedAt !== null,
  }
}

function toReviewResponse(review: GradeReview): GradeReviewResponse {
  return {
    id: review.id,
    assessmentId: review.assessmentId,
    studentId: review.studentId,
    status: review.status,
    reviewerId: review.reviewerId,
    notes: review.notes,
    decidedAt: review.decidedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  }
}

/**
 * Rebuild the post-submission per-question results from the persisted
 * `QuizResponse` rows and the server's answer key. The student's selected option
 * is mapped back to its index so the existing kernel produces the same
 * disclosure shape as the legacy quiz path.
 */
function buildResults(
  questions: readonly QuestionWithOptions[],
  responses: readonly { questionId: string; selectedOptionIds: unknown }[],
  maxScore: number,
) {
  const responseByQuestion = new Map(responses.map((response) => [response.questionId, response]))
  const answers: QuizAnswer[] = questions.map((question) => {
    const response = responseByQuestion.get(question.id)
    const selectedOptionId = response
      ? (readOptionIds(response.selectedOptionIds)[0] ?? null)
      : null
    const selectedIndex = selectedOptionId
      ? question.options.findIndex((option) => option.id === selectedOptionId)
      : null
    return {
      questionId: question.id,
      selectedIndex: selectedIndex !== null && selectedIndex >= 0 ? selectedIndex : null,
    }
  })
  return gradeGeneratedQuiz(toScorable(questions), answers, maxScore).results
}

// ---------------------------------------------------------------------------
// Student reads
// ---------------------------------------------------------------------------

export async function listStudentQuizzes(user: AuthUser): Promise<StudentQuizSummary[]> {
  const studentId = await resolveStudentProfileId(user)
  const now = new Date()
  const maxAttempts = resolveMaxAttempts()

  const assessments = await prisma.assessment.findMany({
    where: {
      type: "QUIZ",
      offering: { enrollments: { some: { studentId, status: "active" } } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      dueDate: true,
      maxMarks: true,
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, metadata: true, options: { select: { isCorrect: true } } },
      },
      quizAttempts: {
        where: { studentId },
        orderBy: { attemptNumber: "asc" },
        select: {
          id: true,
          assessmentId: true,
          attemptNumber: true,
          status: true,
          score: true,
          maxScore: true,
          startedAt: true,
          submittedAt: true,
        },
      },
    },
  })

  return assessments.map((assessment) => {
    const used = assessment.quizAttempts.filter((attempt) =>
      (COUNTED_STATUSES as readonly string[]).includes(attempt.status),
    ).length
    const latest = assessment.quizAttempts.at(-1) ?? null
    const inProgress = assessment.quizAttempts.some((attempt) => attempt.status === "IN_PROGRESS")
    const delivery = quizDeliveryStatus(assessment.questions)

    let canStart = delivery.deliverable
    let blockedReason = delivery.reason
    if (delivery.deliverable && !inProgress) {
      const eligibility = evaluateAttemptEligibility({
        existingAttemptCount: used,
        maxAttempts,
        now,
        dueDate: assessment.dueDate,
      })
      canStart = eligibility.allowed
      blockedReason = eligibility.reason
    }

    return {
      assessmentId: assessment.id,
      title: assessment.title,
      dueDate: assessment.dueDate.toISOString(),
      maxMarks: assessment.maxMarks,
      questionCount: assessment.questions.length,
      maxAttempts,
      attemptsUsed: used,
      attemptsRemaining: Math.max(0, maxAttempts - used),
      canStart,
      blockedReason,
      latestAttempt: latest
        ? serializeAttemptSummary({
            attempt: latest,
            assessmentTitle: assessment.title,
            dueDate: assessment.dueDate,
          })
        : null,
    }
  })
}

async function loadOwnedAttempt(user: AuthUser, attemptId: string) {
  const studentId = await resolveStudentProfileId(user)
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      assessmentId: true,
      studentId: true,
      attemptNumber: true,
      status: true,
      score: true,
      maxScore: true,
      startedAt: true,
      submittedAt: true,
      assessment: { select: { id: true, title: true, maxMarks: true, dueDate: true } },
    },
  })
  // Another student's attempt is reported as not found so the endpoint never
  // confirms that someone else's attempt exists.
  if (!attempt || attempt.studentId !== studentId) {
    throw new QuizAttemptError(404, "Quiz attempt not found.")
  }
  return { attempt, studentId }
}

export async function getStudentAttempt(
  user: AuthUser,
  attemptId: string,
): Promise<QuizAttemptView> {
  const { attempt, studentId } = await loadOwnedAttempt(user, attemptId)

  const [questions, responses, settings] = await Promise.all([
    prisma.question.findMany({
      where: { assessmentId: attempt.assessmentId },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    }),
    prisma.quizResponse.findMany({
      where: { attemptId },
      select: { questionId: true, selectedOptionIds: true },
    }),
    attemptSettings(studentId, attempt.assessmentId),
  ])

  const submitted = attempt.status !== "IN_PROGRESS"
  return {
    ...serializeAttemptSummary({
      attempt,
      assessmentTitle: attempt.assessment.title,
      dueDate: attempt.assessment.dueDate,
    }),
    settings,
    questions: questions.map(serializeStudentQuestion),
    results: submitted ? buildResults(questions, responses, attempt.assessment.maxMarks) : null,
  }
}

export async function listStudentAttempts(
  user: AuthUser,
  assessmentId: string,
): Promise<QuizAttemptSummary[]> {
  const studentId = await resolveStudentProfileId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, title: true, dueDate: true },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")

  const attempts = await prisma.quizAttempt.findMany({
    where: { assessmentId, studentId },
    orderBy: { attemptNumber: "asc" },
    select: {
      id: true,
      assessmentId: true,
      attemptNumber: true,
      status: true,
      score: true,
      maxScore: true,
      startedAt: true,
      submittedAt: true,
    },
  })
  return attempts.map((attempt) =>
    serializeAttemptSummary({
      attempt,
      assessmentTitle: assessment.title,
      dueDate: assessment.dueDate,
    }),
  )
}

/**
 * The failed/unanswered question ids from the student's latest finalized
 * attempt, computed by delegating to the existing adaptive-retake selector —
 * the retake logic is not duplicated here.
 */ export async function latestFailedQuestionIds(
  user: AuthUser,
  assessmentId: string,
): Promise<{ failedQuestionIds: string[]; unansweredQuestionIds: string[] }> {
  const studentId = await resolveStudentProfileId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      questions: { orderBy: { order: "asc" }, select: { id: true } },
      offering: {
        select: {
          enrollments: { where: { studentId, status: "active" }, select: { id: true } },
        },
      },
    },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")
  if (assessment.offering.enrollments.length === 0) {
    throw new QuizAttemptError(403, "You are not enrolled in this assessment offering.")
  }

  const latest = await prisma.quizAttempt.findFirst({
    where: { assessmentId, studentId, status: { in: [...FINALIZED_STATUSES] } },
    orderBy: { attemptNumber: "desc" },
    select: { id: true, responses: { select: { questionId: true, isCorrect: true } } },
  })

  const selection = selectAdaptiveRetakeQuestions({
    questionIds: assessment.questions.map((question) => question.id),
    responses: latest?.responses ?? [],
  })
  return {
    failedQuestionIds: selection.failedQuestionIds,
    unansweredQuestionIds: selection.unansweredQuestionIds,
  }
}

// ---------------------------------------------------------------------------
// Student writes
// ---------------------------------------------------------------------------

export async function startQuizAttempt(user: AuthUser, input: unknown): Promise<QuizAttemptView> {
  const request = quizAttemptStartRequestSchema.parse(input)
  const studentId = await resolveStudentProfileId(user)

  const assessment = await prisma.assessment.findUnique({
    where: { id: request.assessmentId },
    select: {
      id: true,
      type: true,
      dueDate: true,
      questions: {
        orderBy: { order: "asc" },
        include: { options: { orderBy: { order: "asc" } } },
      },
      offering: {
        select: {
          enrollments: { where: { studentId, status: "active" }, select: { id: true } },
        },
      },
    },
  })
  if (!assessment) throw new QuizAttemptError(404, "Assessment not found.")
  if (assessment.type !== "QUIZ") {
    throw new QuizAttemptError(409, "This assessment is not a quiz.")
  }
  if (assessment.offering.enrollments.length === 0) {
    throw new QuizAttemptError(403, "You are not enrolled in this assessment offering.")
  }
  assertDeliverable(assessment.questions)

  // Resume an in-progress attempt rather than burning a new one on a refresh.
  const inProgress = await prisma.quizAttempt.findFirst({
    where: { assessmentId: assessment.id, studentId, status: "IN_PROGRESS" },
    orderBy: { attemptNumber: "desc" },
    select: { id: true },
  })
  if (inProgress) return getStudentAttempt(user, inProgress.id)

  const attempts = await prisma.quizAttempt.findMany({
    where: { assessmentId: assessment.id, studentId },
    select: { attemptNumber: true, status: true },
  })
  const used = attempts.filter((attempt) =>
    (COUNTED_STATUSES as readonly string[]).includes(attempt.status),
  ).length
  const eligibility = evaluateAttemptEligibility({
    existingAttemptCount: used,
    maxAttempts: resolveMaxAttempts(),
    now: new Date(),
    dueDate: assessment.dueDate,
  })
  if (!eligibility.allowed) {
    throw new QuizAttemptError(
      eligibility.code === "cap" ? 429 : 409,
      eligibility.reason ?? "Blocked.",
    )
  }

  const attemptNumber =
    attempts.reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0) + 1
  const created = await prisma.$transaction(async (tx) => {
    const attempt = await tx.quizAttempt.create({
      data: { assessmentId: assessment.id, studentId, attemptNumber, status: "IN_PROGRESS" },
    })
    await writeAuditLog(tx, {
      entityType: "QuizAttempt",
      entityId: attempt.id,
      action: "quiz_attempt.started",
      actor: { id: user.id, role: user.role },
      after: { assessmentId: assessment.id, attemptNumber, status: "IN_PROGRESS" },
    })
    return attempt
  })

  return getStudentAttempt(user, created.id)
}

export async function submitQuizAttempt(
  user: AuthUser,
  attemptId: string,
  input: unknown,
): Promise<QuizAttemptView> {
  const request = quizAttemptSubmitRequestSchema.parse(input)
  const { attempt, studentId } = await loadOwnedAttempt(user, attemptId)

  if (attempt.status !== "IN_PROGRESS") {
    throw new QuizAttemptError(409, "This attempt has already been submitted.")
  }

  const rows = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      responses: { select: { id: true } },
      assessment: {
        select: {
          id: true,
          maxMarks: true,
          dueDate: true,
          type: true,
          offering: {
            select: {
              enrollments: { where: { studentId, status: "active" }, select: { id: true } },
            },
          },
          questions: {
            orderBy: { order: "asc" },
            include: { options: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  })
  if (rows.responses.length > 0) {
    throw new QuizAttemptError(409, "This attempt already has recorded answers.")
  }
  if (rows.assessment.type !== "QUIZ") {
    throw new QuizAttemptError(409, "This assessment is not a quiz.")
  }
  if (rows.assessment.offering.enrollments.length === 0) {
    throw new QuizAttemptError(403, "You are not enrolled in this assessment offering.")
  }
  const questions = rows.assessment.questions
  assertDeliverable(questions)

  const questionById = new Map(questions.map((question) => [question.id, question]))
  const seenAnswers = new Set<string>()
  for (const answer of request.answers) {
    if (seenAnswers.has(answer.questionId)) {
      throw new QuizAttemptError(400, `Duplicate answer for question ${answer.questionId}.`)
    }
    seenAnswers.add(answer.questionId)
    const question = questionById.get(answer.questionId)
    if (!question) {
      throw new QuizAttemptError(400, `Answer references unknown question ${answer.questionId}.`)
    }
    if (
      answer.selectedIndex !== null &&
      (answer.selectedIndex < 0 || answer.selectedIndex >= question.options.length)
    ) {
      throw new QuizAttemptError(
        400,
        `Selected option is out of range for question ${question.id}.`,
      )
    }
  }

  let scored
  try {
    scored = gradeGeneratedQuiz(toScorable(questions), request.answers, rows.assessment.maxMarks)
  } catch (error) {
    if (error instanceof QuizGenerationError) {
      throw new QuizAttemptError(error.status === 409 ? 409 : 400, error.message)
    }
    throw error
  }

  const now = new Date()
  const late = isLateSubmission(now, rows.assessment.dueDate)
  const responseRows = questions.map((question, index) => {
    const result = scored.results[index]
    const selectedOptionId =
      result.selectedIndex === null ? null : (question.options[result.selectedIndex]?.id ?? null)
    return {
      attemptId,
      questionId: question.id,
      selectedOptionIds: selectedOptionId ? [selectedOptionId] : [],
      // An unanswered question is persisted with `isCorrect: null`, not `false`.
      // The analytics item-analysis and adaptive-retake paths distinguish "wrong"
      // (`false`) from "unanswered" (`null`); collapsing them would report every
      // skipped question as failed.
      isCorrect: result.selectedIndex === null ? null : result.isCorrect,
      pointsAwarded: result.points,
      rationale: result.explanation ?? null,
    }
  })

  await prisma.$transaction(async (tx) => {
    // Guard on the status so two concurrent submits cannot both persist answers.
    const updated = await tx.quizAttempt.updateMany({
      where: { id: attemptId, status: "IN_PROGRESS" },
      data: {
        status: "SUBMITTED",
        score: scored.score,
        maxScore: scored.maxScore,
        submittedAt: now,
      },
    })
    if (updated.count === 0) {
      throw new QuizAttemptError(409, "This attempt has already been submitted.")
    }
    await tx.quizResponse.createMany({ data: responseRows })
    await writeAuditLog(tx, {
      entityType: "QuizAttempt",
      entityId: attemptId,
      action: late ? "quiz_attempt.submitted_late" : "quiz_attempt.submitted",
      actor: { id: user.id, role: user.role },
      after: {
        assessmentId: rows.assessment.id,
        attemptNumber: attempt.attemptNumber,
        score: scored.score,
        maxScore: scored.maxScore,
        correctCount: scored.correctCount,
        totalQuestions: scored.totalQuestions,
        late,
      },
    })
  })

  // Deterministic auto-scoring is persisted as a *suggestion*, never a grade.
  // The constant `criterionLabel` is the stable dedupe bucket: a later attempt
  // supersedes the previous draft score instead of adding to it, and a published
  // grade is never rewritten (lib/grading guarantees both).
  await recordAiSuggestion(
    {
      assessmentId: rows.assessment.id,
      studentId,
      criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL,
      suggestedPoints: scored.score,
      maxPoints: scored.maxScore,
      rationale: `Deterministic auto-scoring: ${scored.correctCount} of ${scored.totalQuestions} questions correct${late ? " (submitted after the deadline)" : ""}.`,
      evidence: "Per-question outcomes are persisted on this attempt's QuizResponse rows.",
      confidence: 1,
      model: QUIZ_AUTO_SCORER_MODEL,
      promptVersion: QUIZ_SCORING_PROMPT_VERSION,
      latencyMs: 0,
      rawResponse: {
        attemptId,
        attemptNumber: attempt.attemptNumber,
        correctCount: scored.correctCount,
        totalQuestions: scored.totalQuestions,
        score: scored.score,
        maxScore: scored.maxScore,
        late,
      },
    },
    { role: "system" },
  )

  return getStudentAttempt(user, attemptId)
}

// ---------------------------------------------------------------------------
// Teacher reads (owned assessments/offerings only)
// ---------------------------------------------------------------------------

export async function listTeacherAttempts(
  user: AuthUser,
  assessmentId: string,
): Promise<TeacherQuizAttemptSummary[]> {
  const owned = await loadOwnedAssessment(user, assessmentId)
  const [attempts, reviews, grades] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { assessmentId: owned.id },
      orderBy: [{ attemptNumber: "asc" }],
      select: {
        id: true,
        assessmentId: true,
        studentId: true,
        attemptNumber: true,
        status: true,
        score: true,
        maxScore: true,
        startedAt: true,
        submittedAt: true,
        student: { select: { fullName: true, registerNumber: true } },
      },
    }),
    prisma.gradeReview.findMany({
      where: { assessmentId: owned.id },
      select: { studentId: true, status: true },
    }),
    prisma.grade.findMany({
      where: { assessmentId: owned.id },
      select: { studentId: true, points: true, publishedAt: true },
    }),
  ])

  const reviewByStudent = new Map(reviews.map((review) => [review.studentId, review.status]))
  const gradeByStudent = new Map(grades.map((grade) => [grade.studentId, grade]))

  return attempts.map((attempt) => {
    const grade = gradeByStudent.get(attempt.studentId)
    return {
      ...serializeAttemptSummary({
        attempt,
        assessmentTitle: owned.title,
        dueDate: owned.dueDate,
      }),
      studentId: attempt.studentId,
      studentName: attempt.student.fullName,
      registerNumber: attempt.student.registerNumber,
      reviewStatus: reviewByStudent.get(attempt.studentId) ?? null,
      gradePublishedAt: grade?.publishedAt?.toISOString() ?? null,
      gradePoints: grade ? Number(grade.points) : null,
    }
  })
}

export async function getTeacherAttempt(
  user: AuthUser,
  attemptId: string,
): Promise<TeacherQuizAttemptDetail> {
  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      assessmentId: true,
      studentId: true,
      attemptNumber: true,
      status: true,
      score: true,
      maxScore: true,
      startedAt: true,
      submittedAt: true,
      student: { select: { fullName: true, registerNumber: true } },
    },
  })
  if (!attempt) throw new QuizAttemptError(404, "Quiz attempt not found.")
  const owned = await loadOwnedAssessment(user, attempt.assessmentId)

  const [questions, responses, review, grade] = await Promise.all([
    prisma.question.findMany({
      where: { assessmentId: owned.id },
      orderBy: { order: "asc" },
      include: { options: { orderBy: { order: "asc" } } },
    }),
    prisma.quizResponse.findMany({
      where: { attemptId },
      select: {
        questionId: true,
        selectedOptionIds: true,
        isCorrect: true,
        pointsAwarded: true,
      },
    }),
    prisma.gradeReview.findUnique({
      where: {
        assessmentId_studentId: { assessmentId: owned.id, studentId: attempt.studentId },
      },
    }),
    prisma.grade.findUnique({
      where: {
        assessmentId_studentId: { assessmentId: owned.id, studentId: attempt.studentId },
      },
    }),
  ])

  const responseByQuestion = new Map(responses.map((response) => [response.questionId, response]))
  const serializedResponses = questions.map((question) => {
    const response = responseByQuestion.get(question.id)
    return serializeTeacherResponse({
      question,
      selectedOptionId: response ? (readOptionIds(response.selectedOptionIds)[0] ?? null) : null,
      isCorrect: response?.isCorrect ?? null,
      pointsAwarded: toNumberOrNull(response?.pointsAwarded ?? null),
    })
  })

  return {
    attempt: {
      ...serializeAttemptSummary({
        attempt,
        assessmentTitle: owned.title,
        dueDate: owned.dueDate,
      }),
      studentId: attempt.studentId,
      studentName: attempt.student.fullName,
      registerNumber: attempt.student.registerNumber,
      reviewStatus: review?.status ?? null,
      gradePublishedAt: grade?.publishedAt?.toISOString() ?? null,
      gradePoints: grade ? Number(grade.points) : null,
    },
    responses: serializedResponses,
    review: review ? toReviewResponse(review) : null,
    grade: grade ? toGradeResponse(grade) : null,
  }
}
