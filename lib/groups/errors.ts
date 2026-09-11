/**
 * Errors thrown by the groups / peer-evaluation pod. They carry an HTTP status so
 * route handlers can translate them without string matching (the same convention
 * as `lib/quiz-generation/errors.ts` and `lib/rubric-grading/errors.ts`).
 */
export type GroupStatusError = 400 | 401 | 403 | 404 | 409 | 422

export class GroupError extends Error {
  constructor(
    readonly status: GroupStatusError,
    message: string,
  ) {
    super(message)
    this.name = "GroupError"
  }
}

/** The caller supplied input that does not satisfy the domain rules. */
export class GroupValidationError extends GroupError {
  constructor(message: string) {
    super(400, message)
    this.name = "GroupValidationError"
  }
}

/**
 * Team formation could not satisfy the requested constraints: a student has no
 * schedule-compatible team, or the requested shape is impossible. This is a
 * deliberate hard failure — the pod never forms a team with incompatible
 * schedules just to fill a slot.
 */
export class TeamFormationError extends GroupError {
  constructor(message: string) {
    super(422, message)
    this.name = "TeamFormationError"
  }
}
