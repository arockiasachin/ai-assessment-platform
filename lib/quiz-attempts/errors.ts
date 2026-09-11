/**
 * Errors thrown by the quiz-attempt pod. They carry an HTTP status so route
 * handlers translate them without string matching (the same convention as
 * `lib/quiz-generation/errors.ts` and `lib/code-eval/errors.ts`).
 *
 * `429` is used for the attempt cap (too many attempts) and `409` for a
 * deadline/state conflict on an existing attempt, matching the code-evaluation
 * submission policy.
 */
export type QuizAttemptStatus = 400 | 401 | 403 | 404 | 409 | 429

export class QuizAttemptError extends Error {
  constructor(
    readonly status: QuizAttemptStatus,
    message: string,
  ) {
    super(message)
    this.name = "QuizAttemptError"
  }
}

/** The quiz exists but is not yet deliverable (no questions or draft questions). */
export class QuizNotDeliverableError extends QuizAttemptError {
  constructor(message: string) {
    super(409, message)
    this.name = "QuizNotDeliverableError"
  }
}
