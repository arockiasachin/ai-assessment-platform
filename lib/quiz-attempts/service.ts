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
import {
  isTextQuestionType,
  normalizeQuestionPoints,
  scoreQuiz,
  type ScorableQuizQuestion,
} from "@/lib/quiz-scoring"
import { resolveTextSimilarityThreshold } from "@/lib/quiz-scoring-text"
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
import { gradeTextAnswer, type TextGradeResult } from "./text-grader"
import { recordTextQuizSuggestions } from "./text-suggestions"

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

type TextGradingContext = {
  answerByQuestion: Map<string, QuizAnswer>
  grades: Map<string, TextGradeResult>
  manualQuestionIds: Set<string>
}

function toScorable(
  questions: readonly QuestionWithOptions[],
  context: TextGradingContext,
): GeneratedQuestionForScoring[] {
  return questions.map((question) => {
    if (isTextQuestionType(question.type)) {
      const answer = context.answerByQuestion.get(question.id)
      const answerText = answer?.answerText?.trim() ?? ""
      const grade = context.grades.get(question.id)
      const manual = context.manualQuestionIds.has(question.id)
      return {
        id: question.id,
        prompt: question.prompt,
        explanation: question.explanation ?? null,
        options: [],
        points: Number(question.points),
        type: question.type,
        textSimilarity: grade?.similarity ?? null,
        textEligible: grade?.eligible,
        answerText: answerText.length > 0 ? answerText : null,
        rationale:
          grade?.rationale ??
          (manual ? "No reference answer is configured; a teacher must score this answer." : null),
        confidence: grade?.confidence ?? (manual ? 0 : null),
        needsManualReview: manual,
      }
    }
    return {
      id: question.id,
      prompt: question.prompt,
      explanation: question.explanation ?? null,
      options: [...question.options]
        .sort((a, b) => a.order - b.order)
        .map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
      points: Number(question.points),
      type: question.type,
    }
  })
}

function assertDeliverable(questions: readonly QuestionWithOptions[]): void {
  const delivery = quizDeliveryStatus(questions)
  if (!delivery.deliverable) {
    throw new QuizNotDeliverableError(delivery.reason ?? "This quiz is not open yet.")
  }
}

async function attemptSettings(
  studentId: string,
  assessmentId: string,
  assessmentMaxAttempts: number | null,
) {
  const attempts = await prisma.quizAttempt.findMany({
    where: { assessmentId, studentId },
    select: { status: true },
  })
  const maxAttempts = resolveMaxAttempts(assessmentMaxAttempts)
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
 * `QuizResponse` rows and the server's answer key. Choice questions are
 * re-derived through the kernel (the same disclosure shape as the legacy quiz
 * path); free-text questions are read back from their persisted score, rationale
 * and prose, because their partial credit was computed asynchronously and is
 * already stored.
 */
function buildResults(
  questions: readonly QuestionWithOptions[],
  responses: readonly {
    questionId: string
    selectedOptionIds: unknown
    answerText: string | null
    isCorrect: boolean | null
    pointsAwarded: unknown
    rationale: string | null
  }[],
  maxScore: number,
) {
  const responseByQuestion = new Map(responses.map((response) => [response.questionId, response]))

  const choiceQuestions = questions.filter((question) => !isTextQuestionType(question.type))
  const scorable: ScorableQuizQuestion[] = choiceQuestions.map((question) => {
    const sortedOptions = [...question.options].sort((a, b) => a.order - b.order)
    return {
      id: question.id,
      prompt: question.prompt,
      options: sortedOptions.map((option) => option.text),
      correctIndex: sortedOptions.findIndex((option) => option.isCorrect),
      explanation: question.explanation ?? null,
      points: Number(question.points),
      type: question.type,
    }
  })
  const choiceAnswers: QuizAnswer[] = choiceQuestions.map((question) => {
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
  const choiceById = new Map(
    scoreQuiz(scorable, choiceAnswers, maxScore).results.map((result) => [
      result.questionId,
      result,
    ]),
  )

  return questions.map((question) => {
    if (!isTextQuestionType(question.type)) {
      return choiceById.get(question.id)!
    }
    const response = responseByQuestion.get(question.id)
    const answerText = response?.answerText ?? null
    const pointsAwarded = toNumberOrNull(response?.pointsAwarded ?? null)
    const hasAnswer = answerText !== null && answerText.trim().length > 0
    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedIndex: null,
      selectedText: null,
      correctIndex: -1,
      correctText: "",
      explanation: question.explanation ?? null,
      isCorrect: response?.isCorrect ?? null,
      points: pointsAwarded ?? 0,
      maxPoints: normalizeQuestionPoints(toNumberOrNull(question.points)),
      answerText,
      rationale: response?.rationale ?? null,
      confidence: null,
      similarity: null,
      needsManualReview: hasAnswer && pointsAwarded === null,
    }
  })
}

// ---------------------------------------------------------------------------
// Student reads
// ---------------------------------------------------------------------------

export async function listStudentQuizzes(user: AuthUser): Promise<StudentQuizSummary[]> {
  const studentId = await resolveStudentProfileId(user)
  const now = new Date()

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
      maxAttempts: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          type: true,
          status: true,
          metadata: true,
          options: { select: { isCorrect: true } },
        },
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
    const maxAttempts = resolveMaxAttempts(assessment.maxAttempts)
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
      assessment: {
        select: { id: true, title: true, maxMarks: true, dueDate: true, maxAttempts: true },
      },
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
      select: {
        questionId: true,
        selectedOptionIds: true,
        answerText: true,
        isCorrect: true,
        pointsAwarded: true,
        rationale: true,
      },
    }),
    attemptSettings(studentId, attempt.assessmentId, attempt.assessment.maxAttempts),
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
      maxAttempts: true,
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

  // Everything that decides the next attempt number runs under a lock on the
  // assessment row. Without it, two concurrent starts each read the same count,
  // both compute the same `attemptNumber`, and the loser collides on the
  // `(assessmentId, studentId, attemptNumber)` unique key — surfacing a generic
  // 500 to a student who simply double-tapped "Start". Serializing here also
  // closes the check-then-create window on the attempt cap.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Assessment" WHERE "id" = ${assessment.id} FOR UPDATE`

    const existing = await tx.quizAttempt.findFirst({
      where: { assessmentId: assessment.id, studentId, status: "IN_PROGRESS" },
      orderBy: { attemptNumber: "desc" },
      select: { id: true },
    })
    if (existing) return { id: existing.id }

    const attempts = await tx.quizAttempt.findMany({
      where: { assessmentId: assessment.id, studentId },
      select: { attemptNumber: true, status: true },
    })
    const used = attempts.filter((attempt) =>
      (COUNTED_STATUSES as readonly string[]).includes(attempt.status),
    ).length
    const eligibility = evaluateAttemptEligibility({
      existingAttemptCount: used,
      maxAttempts: resolveMaxAttempts(assessment.maxAttempts),
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
    return { id: attempt.id }
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
    const isText = isTextQuestionType(question.type)
    const hasText = answer.answerText !== undefined
    const hasChoice = answer.selectedIndex !== null
    if (hasText && hasChoice) {
      throw new QuizAttemptError(
        400,
        `Question ${question.id} accepts either a selected option or a text answer, not both.`,
      )
    }
    if (isText) {
      if (hasChoice) {
        throw new QuizAttemptError(
          400,
          `Question ${question.id} is a free-text question and does not accept a selected option.`,
        )
      }
      if (hasText && answer.answerText!.length === 0) {
        throw new QuizAttemptError(
          400,
          `The text answer for question ${question.id} cannot be empty.`,
        )
      }
    } else {
      if (hasText) {
        throw new QuizAttemptError(
          400,
          `Question ${question.id} is multiple choice and does not accept a text answer.`,
        )
      }
      if (
        hasChoice &&
        (answer.selectedIndex! < 0 || answer.selectedIndex! >= question.options.length)
      ) {
        throw new QuizAttemptError(
          400,
          `Selected option is out of range for question ${question.id}.`,
        )
      }
    }
  }

  const answerByQuestion = new Map(request.answers.map((answer) => [answer.questionId, answer]))
  const threshold = resolveTextSimilarityThreshold()
  const textGrades = new Map<string, TextGradeResult>()
  const manualQuestionIds = new Set<string>()

  for (const question of questions) {
    if (!isTextQuestionType(question.type)) continue
    const answerText = answerByQuestion.get(question.id)?.answerText?.trim() ?? ""
    if (answerText.length === 0) continue
    const referenceAnswer = question.explanation?.trim() ?? ""
    if (referenceAnswer.length === 0) {
      // There is no reference answer to compare against. Never invent one: the
      // answer is routed to a teacher for manual scoring instead.
      manualQuestionIds.add(question.id)
      continue
    }
    textGrades.set(
      question.id,
      await gradeTextAnswer({
        questionPrompt: question.prompt,
        referenceAnswer,
        answerText,
        maxPoints: normalizeQuestionPoints(Number(question.points)),
        threshold,
      }),
    )
  }

  const gradingContext: TextGradingContext = {
    answerByQuestion,
    grades: textGrades,
    manualQuestionIds,
  }

  let scored
  try {
    scored = gradeGeneratedQuiz(
      toScorable(questions, gradingContext),
      request.answers,
      rows.assessment.maxMarks,
    )
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
    const isText = isTextQuestionType(question.type)
    const answer = answerByQuestion.get(question.id)
    const submittedText = isText ? (answer?.answerText?.trim() ?? "") : ""
    const answerText = submittedText.length > 0 ? submittedText : null
    const selectedOptionId =
      result.selectedIndex === null ? null : (question.options[result.selectedIndex]?.id ?? null)
    const manual = manualQuestionIds.has(question.id)
    return {
      attemptId,
      questionId: question.id,
      selectedOptionIds: selectedOptionId ? [selectedOptionId] : [],
      answerText,
      // An unanswered question is persisted with `isCorrect: null`, not `false`.
      // The analytics item-analysis and adaptive-retake paths distinguish "wrong"
      // (`false`) from "unanswered" (`null`); collapsing them would report every
      // skipped question as failed. A partially correct free-text answer is also
      // `null` — the schema's representation of "partially correct".
      isCorrect: isText
        ? answerText === null
          ? null
          : result.isCorrect
        : result.selectedIndex === null
          ? null
          : result.isCorrect,
      // A manual-review answer is deliberately left unscored (`null`) rather
      // than recorded as a guessed zero.
      pointsAwarded: manual ? null : result.points,
      // For a text answer `rationale` is the grader's justification; for a
      // choice answer it keeps the legacy explanation echo.
      rationale: isText ? (result.rationale ?? null) : (result.explanation ?? null),
    }
  })

  const hasTextQuestions = questions.some((question) => isTextQuestionType(question.type))

  const createdResponses = await prisma.$transaction(async (tx) => {
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
    const created = await tx.quizResponse.createManyAndReturn({
      data: responseRows,
      select: { id: true, questionId: true },
    })
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
        textQuestionCount: scored.results.filter((result) => result.similarity !== null).length,
        manualReviewQuestionIds: [...manualQuestionIds],
        late,
      },
    })
    return created
  })

  if (hasTextQuestions) {
    await recordTextQuizSuggestions({
      assessmentId: rows.assessment.id,
      studentId,
      attemptId,
      attemptNumber: attempt.attemptNumber,
      questions,
      results: scored.results,
      responseIdByQuestion: new Map(createdResponses.map((row) => [row.questionId, row.id])),
      textGrades,
      manualQuestionIds,
      targetScore: scored.score,
      maxScore: scored.maxScore,
      late,
    })
  } else {
    // Choice-only quizzes keep the original single, deterministic whole-quiz
    // suggestion. Its constant `criterionLabel` is the stable dedupe bucket: a
    // later attempt supersedes the previous draft score instead of adding to it,
    // and a published grade is never rewritten (lib/grading guarantees both).
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
  }

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
        answerText: true,
        isCorrect: true,
        pointsAwarded: true,
        rationale: true,
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
      answerText: response?.answerText ?? null,
      isCorrect: response?.isCorrect ?? null,
      pointsAwarded: toNumberOrNull(response?.pointsAwarded ?? null),
      rationale: response?.rationale ?? null,
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
