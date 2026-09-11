/**
 * Errors thrown by the analytics pod. They carry an HTTP status so route
 * handlers can translate them without string matching (the same convention as
 * `lib/groups/errors.ts` and `lib/quiz-generation/errors.ts`).
 */
export type AnalyticsStatusError = 400 | 401 | 403 | 404 | 422

export class AnalyticsError extends Error {
  constructor(
    readonly status: AnalyticsStatusError,
    message: string,
  ) {
    super(message)
    this.name = "AnalyticsError"
  }
}
