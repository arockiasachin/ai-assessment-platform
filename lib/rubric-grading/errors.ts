/**
 * Errors thrown by the rubric-grading pod. They carry an HTTP status so route
 * handlers can translate them without string matching (the same convention as
 * `lib/grading/errors.ts`).
 */
export type RubricGradingStatus = 400 | 401 | 403 | 404 | 409 | 422 | 502

export class RubricGradingError extends Error {
  constructor(
    readonly status: RubricGradingStatus,
    message: string,
  ) {
    super(message)
    this.name = "RubricGradingError"
  }
}

/**
 * The rubric failed the coherence checks: missing criteria, duplicate labels,
 * non-positive weights/points, levels above the criterion ceiling, or a total
 * that disagrees with the assessment's point ceiling.
 */
export class RubricValidationError extends RubricGradingError {
  constructor(readonly issues: readonly string[]) {
    super(400, issues[0] ?? "Invalid rubric.")
    this.name = "RubricValidationError"
  }
}

/**
 * The model response for one criterion could not be turned into a score,
 * rationale, quoted evidence, and confidence. We fail loudly instead of
 * inventing a number, because an unparseable score is not a grade.
 */
export class CriterionParseError extends RubricGradingError {
  constructor(message: string) {
    super(502, message)
    this.name = "CriterionParseError"
  }
}
