/**
 * Errors thrown by the LMS-export / weighted-final-grade pod. They carry an HTTP
 * status so route handlers can translate them without string matching (the same
 * convention as `lib/analytics/errors.ts` and `lib/groups/errors.ts`).
 */
export type LmsExportStatusError = 400 | 401 | 403 | 404 | 409 | 422

export class LmsExportError extends Error {
  constructor(
    readonly status: LmsExportStatusError,
    message: string,
  ) {
    super(message)
    this.name = "LmsExportError"
  }
}

/** The caller supplied input that does not satisfy the domain rules. */
export class LmsExportValidationError extends LmsExportError {
  constructor(message: string) {
    super(400, message)
    this.name = "LmsExportValidationError"
  }
}

/** LTI 1.3 AGS is required for this operation but the environment is incomplete. */
export class LtiConfigurationError extends LmsExportError {
  constructor(message: string) {
    super(422, message)
    this.name = "LtiConfigurationError"
  }
}

/** An attempt to build or send a score for a grade that is not published. */
export class LtiUnpublishedGradeError extends LmsExportError {
  constructor(message: string) {
    super(409, message)
    this.name = "LtiUnpublishedGradeError"
  }
}
