import type { QuizAnswer, QuizQuestionResult } from "@/lib/contracts/quiz"

/**
 * Pure quiz scoring kernel.
 *
 * Correctness is derived *only* from the server-side `correctIndex` on each
 * scorable question — never from anything the client sent. This module is
 * intentionally free of database and Next.js imports so the scoring rule is
 * trivially unit-testable and cannot leak an answer key on its own.
 */

export class QuizScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QuizScoringError"
  }
}

export type ScorableQuizQuestion = {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation?: string | null
}

export type ScoredQuiz = {
  results: QuizQuestionResult[]
  correctCount: number
  totalQuestions: number
  score: number
  maxScore: number
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

  const results: QuizQuestionResult[] = questions.map((question) => {
    const answer = answerByQuestion.get(question.id)
    const selectedIndex = answer?.selectedIndex ?? null
    const isCorrect = selectedIndex !== null && selectedIndex === question.correctIndex

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedIndex,
      selectedText: selectedIndex !== null ? (question.options[selectedIndex] ?? null) : null,
      correctIndex: question.correctIndex,
      correctText: question.options[question.correctIndex] ?? "",
      explanation: question.explanation ?? null,
      isCorrect,
      points: isCorrect ? 1 : 0,
      maxPoints: 1,
    }
  })

  const correctCount = results.filter((result) => result.isCorrect).length
  const totalQuestions = questions.length

  return {
    results,
    correctCount,
    totalQuestions,
    score: totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * maxScore) : 0,
    maxScore,
  }
}
