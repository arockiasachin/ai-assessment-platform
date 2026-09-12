import type { QuizAnswer, QuizQuestionResult } from "@/lib/contracts/quiz"
import { clamp01 } from "@/lib/text-similarity"

import { roundPoints } from "./quiz-scoring-text"

/**
 * Pure quiz scoring kernel.
 *
 * Correctness for choice questions is derived *only* from the server-side
 * `correctIndex` on each scorable question — never from anything the client
 * sent. Free-text questions are scored from a similarity the caller has already
 * computed (the semantic grader or its deterministic fallback), so this module
 * stays synchronous and free of database, model, and Next.js imports.
 *
 * `Question.points` is the per-question weight the client is shown. Scoring is
 * weighted: a question is worth its `points` relative to the sum of every
 * question's points, and the ratio is projected onto the assessment's
 * `maxScore`. A missing, zero, or non-finite weight falls back to `1`, so a
 * quiz whose questions all keep the default of `1` scores exactly as it did
 * when every question was weighted equally (`correctCount / total × maxScore`).
 */

export class QuizScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QuizScoringError"
  }
}

/** Every question is worth 1 mark unless it declares a usable positive weight. */
export const DEFAULT_QUESTION_POINTS = 1

/**
 * Question types graded from free text rather than a selected option. Kept as a
 * string set (not the Prisma enum) so this pure kernel stays import-free.
 */
export const TEXT_QUESTION_TYPES = ["SHORT_ANSWER", "ESSAY"] as const

export function isTextQuestionType(type: string | null | undefined): boolean {
  return typeof type === "string" && (TEXT_QUESTION_TYPES as readonly string[]).includes(type)
}

export function normalizeQuestionPoints(points: number | null | undefined): number {
  return typeof points === "number" && Number.isFinite(points) && points > 0
    ? points
    : DEFAULT_QUESTION_POINTS
}

export type ScorableQuizQuestion = {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation?: string | null
  /** Optional per-question weight; defaults to 1. */
  points?: number
  /** The question type; `SHORT_ANSWER`/`ESSAY` are graded from text. */
  type?: string | null
  /**
   * Free-text similarity in [0, 1] for a text question, already computed by the
   * caller. Ignored for choice questions.
   */
  textSimilarity?: number | null
  /** Whether the text answer cleared the similarity threshold. Defaults to `similarity > 0`. */
  textEligible?: boolean
  /** The student's submitted prose, echoed into the result (never an answer key). */
  answerText?: string | null
  /** Grader rationale for a text answer. */
  rationale?: string | null
  /** Grader confidence for a text answer, in [0, 1]. */
  confidence?: number | null
  /** True when a text answer has no reference answer and must be scored by a human. */
  needsManualReview?: boolean
}

export type ScoredQuiz = {
  results: QuizQuestionResult[]
  correctCount: number
  totalQuestions: number
  score: number
  maxScore: number
}

function scoreTextQuestion(
  question: ScorableQuizQuestion,
  maxPoints: number,
): Pick<QuizQuestionResult, "points" | "isCorrect" | "similarity" | "needsManualReview"> {
  const similarity = clamp01(question.textSimilarity ?? 0)
  const needsManualReview = question.needsManualReview === true
  if (needsManualReview) {
    return { points: 0, isCorrect: null, similarity, needsManualReview: true }
  }
  const eligible = question.textEligible ?? similarity > 0
  const points = eligible
    ? Math.max(0, Math.min(maxPoints, roundPoints(similarity * maxPoints)))
    : 0
  // Partial credit is represented as `null` (neither fully correct nor wrong),
  // mirroring the nullable `QuizResponse.isCorrect` column the schema reserves
  // for exactly this case. Full marks are `true`; a zero-scoring answer is
  // `false` so the adaptive-retake selector still treats it as failed.
  const isCorrect = points <= 0 ? false : points >= maxPoints ? true : null
  return { points, isCorrect, similarity, needsManualReview: false }
}

export function scoreQuiz(
  questions: ScorableQuizQuestion[],
  answers: QuizAnswer[],
  maxScore: number,
): ScoredQuiz {
  const answerByQuestion = new Map<string, QuizAnswer>()
  for (const answer of answers) {
    if (answerByQuestion.has(answer.questionId)) {
      throw new QuizScoringError(`Duplicate answer for question ${answer.questionId}.`)
    }
    answerByQuestion.set(answer.questionId, answer)
  }

  const knownIds = new Set(questions.map((question) => question.id))
  for (const answer of answers) {
    if (!knownIds.has(answer.questionId)) {
      throw new QuizScoringError(`Answer references unknown question ${answer.questionId}.`)
    }
  }

  const pointsPerQuestion = questions.map((question) => normalizeQuestionPoints(question.points))
  const totalPoints = pointsPerQuestion.reduce((sum, points) => sum + points, 0)

  let earnedPoints = 0
  const results: QuizQuestionResult[] = questions.map((question, index) => {
    const answer = answerByQuestion.get(question.id)
    const selectedIndex = answer?.selectedIndex ?? null
    const maxPoints = pointsPerQuestion[index]

    if (isTextQuestionType(question.type)) {
      const text = scoreTextQuestion(question, maxPoints)
      earnedPoints += text.points
      return {
        questionId: question.id,
        prompt: question.prompt,
        selectedIndex: null,
        selectedText: null,
        // A free-text question has no option key; `-1` keeps the existing shape.
        correctIndex: -1,
        correctText: "",
        // `explanation` is the reference answer and is only disclosed here,
        // after submission.
        explanation: question.explanation ?? null,
        isCorrect: text.isCorrect,
        points: text.points,
        maxPoints,
        answerText: question.answerText ?? null,
        rationale: question.rationale ?? null,
        confidence: question.confidence ?? null,
        similarity: text.similarity,
        needsManualReview: text.needsManualReview,
      }
    }

    const isCorrect = selectedIndex !== null && selectedIndex === question.correctIndex
    const points = isCorrect ? maxPoints : 0
    if (isCorrect) earnedPoints += maxPoints

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedIndex,
      selectedText: selectedIndex !== null ? (question.options[selectedIndex] ?? null) : null,
      correctIndex: question.correctIndex,
      correctText: question.options[question.correctIndex] ?? "",
      explanation: question.explanation ?? null,
      isCorrect,
      points,
      maxPoints,
      answerText: null,
      rationale: null,
      confidence: null,
      similarity: null,
      needsManualReview: false,
    }
  })

  const correctCount = results.filter((result) => result.isCorrect === true).length
  const totalQuestions = questions.length

  // `totalPoints > 0` whenever there is at least one question (every weight is
  // >= 1), so this guards the empty-quiz case rather than any real division by
  // zero. `earnedPoints <= totalPoints`, so the ratio is in [0, 1]; the clamp is
  // belt-and-braces against floating-point drift and a non-positive `maxScore`.
  const boundedMaxScore = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0
  const ratio = totalPoints > 0 ? earnedPoints / totalPoints : 0
  const score = Math.max(0, Math.min(boundedMaxScore, Math.round(ratio * boundedMaxScore)))

  return {
    results,
    correctCount,
    totalQuestions,
    score,
    maxScore: boundedMaxScore,
  }
}
