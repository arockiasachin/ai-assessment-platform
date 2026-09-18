/**
 * Whether a course offering's term has finished.
 *
 * One definition of "closed", so the teacher's authoring surfaces and the
 * student's registration rule cannot drift. `CourseOffering.endsOn` is the
 * column that means "this term is over"; a missing value is not closed, because
 * a term with no end date is unscheduled rather than finished.
 *
 * A new assessment used to be authorable into a completed 2025 offering with no
 * guard, and then rendered in the current-term grid and planner (TN-62).
 */
export function isOfferingClosed(
  endsOn: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (endsOn === null || endsOn === undefined || endsOn === "") return false
  const end = endsOn instanceof Date ? endsOn : new Date(endsOn)
  if (Number.isNaN(end.getTime())) return false
  return end.getTime() < now.getTime()
}
