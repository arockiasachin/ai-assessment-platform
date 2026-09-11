/**
 * Errors thrown by the code-evaluation pod. They carry an HTTP status so route
 * handlers translate them without string matching (the same convention as
 * `lib/quiz-generation/errors.ts` and `lib/rubric-grading/errors.ts`).
 */
export type CodeEvalStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503

export class CodeEvalError extends Error {
  constructor(
    readonly status: CodeEvalStatus,
    message: string,
  ) {
    super(message)
    this.name = "CodeEvalError"
  }
}

/** The submitted code or a test-case definition does not satisfy the rules. */
export class CodeEvalValidationError extends CodeEvalError {
  constructor(readonly issues: readonly string[]) {
    super(400, issues[0] ?? "Invalid request.")
    this.name = "CodeEvalValidationError"
  }
}

/** The sandbox could not run (no Docker daemon, spawn failure). */
export class SandboxUnavailableError extends CodeEvalError {
  constructor(message: string) {
    super(503, message)
    this.name = "SandboxUnavailableError"
  }
}

/** The model response could not be turned into valid test cases. */
export class TestGenerationParseError extends CodeEvalError {
  constructor(message: string) {
    super(502, message)
    this.name = "TestGenerationParseError"
  }
}
