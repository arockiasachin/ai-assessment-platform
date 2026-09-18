/**
 * Pure view logic for the adaptive-retake surface.
 *
 * The retake dropdown printed `(0 to retry)` for a perfect score while the card
 * below it said "Nothing to retry — you answered every question correctly"
 * (SN-45). The two surfaces now share one phrase so they cannot disagree again.
 */

/** What the student has left to retry, in words rather than a bare count. */
export function retakeCountPhrase(toRetry: number): string {
  return toRetry === 0 ? "nothing to retry" : `${toRetry} to retry`
}

/** The option's label, used by both the trigger and the menu so they cannot drift. */
export function retakeOptionLabel(input: {
  courseCode: string
  title: string
  toRetry: number
}): string {
  return `${input.courseCode} · ${input.title} (${retakeCountPhrase(input.toRetry)})`
}

/**
 * The card heading's count clause, or empty at zero.
 *
 * "0 question(s) to retry" beside "Nothing to retry" was the same defect as the
 * dropdown's: a count rendered without a case for none.
 */
export function retakeQuestionCountClause(questionCount: number): string {
  if (questionCount === 0) return ""
  return ` — ${questionCount} question${questionCount === 1 ? "" : "s"} to retry`
}
