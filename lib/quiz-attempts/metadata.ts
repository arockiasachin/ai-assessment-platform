import { isTextQuestionType } from "@/lib/quiz-scoring"

import { resolveGenerationStatus } from "@/lib/quiz-generation/metadata"

/**
 * Quiz deliverability.
 *
 * There is no assessment-level publish flag on the frozen schema, so "published
 * quiz" is derived from the questions the assessment actually has:
 *
 * - A generated question (explicit `Question.status`, or the legacy
 *   `Question.metadata` envelope for rows written before the column existed) is
 *   part of the quiz only when its state resolves to `"published"`. A draft is
 *   not served. This reuses the generation pod's single draft/published marker
 *   rather than inventing a second one.
 * - A question without that envelope is a hand-authored question and is treated
 *   as published (the generation pod's own rule: "a question without this
 *   metadata marker is never treated as a generated draft").
 * - A choice question must have at least two options and exactly one correct
 *   option, because server-side scoring (`lib/quiz-scoring.ts`) needs a single
 *   unambiguous `correctIndex`. A free-text (`SHORT_ANSWER`/`ESSAY`) question
 *   has no options by design and is exempt from the option checks.
 *
 * **The published subset is the whole contract (TN-41).** One draft question
 * used to make the entire quiz undeliverable while two other surfaces still
 * counted all five, so a student saw `quizQuestionCount: 0` beside a delivery of
 * five. Drafts are simply not part of what is served: the served questions and
 * every count of them come from `publishedQuizQuestions`, so the two can no
 * longer disagree. A quiz with **zero** published questions is a different case
 * from one with no questions at all — it is authored but unpublished — and is
 * still not deliverable, because there is no content to serve.
 *
 * The result is computed from server rows only. It never depends on a client
 * payload, and it never exposes which option is correct.
 */

export type QuizQuestionState = {
  status: string | null
  metadata: unknown
}

export type QuizQuestionAvailability = QuizQuestionState & {
  type?: string | null
  options: readonly { isCorrect: boolean }[]
}

export type QuizDeliverability<T extends QuizQuestionAvailability = QuizQuestionAvailability> = {
  deliverable: boolean
  reason: string | null
  /** The subset that may be served: empty whenever `deliverable` is false. */
  questions: T[]
  /** How many generated drafts are held back from the served subset. */
  draftCount: number
}

/**
 * The one draft/published rule, used by every count and every delivery path.
 *
 * A question is part of the quiz when it is published or carries no generation
 * marker at all (hand-authored). Anything else — an explicit non-published
 * status, or the legacy `generationStatus` envelope — is a draft and is held
 * back.
 */
export function publishedQuizQuestions<T extends QuizQuestionState>(questions: readonly T[]): T[] {
  return questions.filter((question) => {
    const status = resolveGenerationStatus(question)
    return status === null || status === "published"
  })
}

/**
 * Whether the published subset can be served, and what it is.
 *
 * `questions` is always the exact set a teacher's published questions define, so
 * callers serve it rather than re-deriving a subset of their own. When the
 * subset is empty or malformed the quiz is not deliverable and `questions` is
 * empty — never the rejected set.
 */
export function quizDeliveryStatus<T extends QuizQuestionAvailability>(
  questions: readonly T[],
): QuizDeliverability<T> {
  const deliverableQuestions = publishedQuizQuestions(questions)
  const draftCount = questions.length - deliverableQuestions.length

  if (deliverableQuestions.length === 0) {
    return {
      deliverable: false,
      reason:
        questions.length === 0
          ? "This quiz has no questions yet."
          : "This quiz has no published questions yet.",
      questions: [],
      draftCount,
    }
  }

  const notDeliverable = (reason: string): QuizDeliverability<T> => ({
    deliverable: false,
    reason,
    questions: [],
    draftCount,
  })

  for (const question of deliverableQuestions) {
    if (isTextQuestionType(question.type)) continue
    if (question.options.length < 2) {
      return notDeliverable("This quiz has a question with too few options.")
    }
    const correctCount = question.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      return notDeliverable("This quiz has a question without exactly one correct answer.")
    }
  }

  return {
    deliverable: true,
    reason: null,
    questions: deliverableQuestions,
    draftCount,
  }
}
