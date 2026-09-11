/**
 * Errors thrown by the quiz-generation pod. They carry an HTTP status so route
 * handlers can translate them without string matching (the same convention as
 * `lib/rubric-grading/errors.ts`).
 */
export type QuizGenerationStatus = 400 | 401 | 403 | 404 | 409 | 422 | 502

export class QuizGenerationError extends Error {
  constructor(
    readonly status: QuizGenerationStatus,
    message: string,
  ) {
    super(message)
    this.name = "QuizGenerationError"
  }
}

/**
 * The model response could not be turned into valid questions: malformed JSON,
 * a missing question array, the wrong number of options, or not exactly one
 * correct answer. We fail loudly rather than inventing a question, because an
 * unparseable generation is not a draft.
 */
export class QuizGenerationParseError extends QuizGenerationError {
  constructor(message: string) {
    super(502, message)
    this.name = "QuizGenerationParseError"
  }
}

/** The teacher supplied a draft that does not satisfy the question rules. */
export class QuizGenerationValidationError extends QuizGenerationError {
  constructor(readonly issues: readonly string[]) {
    super(400, issues[0] ?? "Invalid question.")
    this.name = "QuizGenerationValidationError"
  }
}
