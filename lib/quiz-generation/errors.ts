/**
 * Errors thrown by the quiz-generation pod. They carry an HTTP status so route
 * handlers can translate them without string matching (the same convention as
 * `lib/rubric-grading/errors.ts` and `lib/grading/errors.ts`).
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
 * The model response could not be turned into well-formed questions: not valid
 * JSON, the wrong number of questions, an option count outside 4-5, zero or
 * multiple correct options, or duplicated prompts/options. We fail loudly
 * instead of persisting a malformed draft.
 */
export class QuizGenerationParseError extends QuizGenerationError {
  constructor(message: string) {
    super(502, message)
    this.name = "QuizGenerationParseError"
  }
}

/**
 * A teacher-supplied edit violated the question shape (for example an option
 * list without exactly one correct answer). This is a request error, not a
 * model failure.
 */
export class QuizGenerationValidationError extends QuizGenerationError {
  constructor(message: string) {
    super(400, message)
    this.name = "QuizGenerationValidationError"
  }
}
