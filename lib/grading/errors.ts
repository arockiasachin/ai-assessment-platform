/**
 * Errors thrown by the grading service. They carry an HTTP status so a route
 * handler can translate them without string matching.
 */
export class GradePipelineError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = "GradePipelineError"
  }
}
