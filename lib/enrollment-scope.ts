/**
 * Which enrollment rows count as a student's live courses, stated once.
 *
 * "Active or waitlisted" was implemented in three places — the student assessment reader's
 * query, the legacy quiz grader's ownership check, and the gradebook projection's enrollment
 * include — and the third omitted it entirely, so a dropped or withdrawn student was still
 * scoped into `GET /api/gradebook` and received course names, assessment titles and class
 * averages (`SN-37`). A rule copied per surface is how this project has produced its recurring
 * "correct on the paths someone considered" defects, so the predicate lives here.
 *
 * `dropped` and `withdrawn` are deliberately excluded: a student whose place is gone may keep
 * read-only history elsewhere, but a live course workspace is not theirs.
 *
 * Zero imports on purpose — safe from a route, a service and a test alike.
 */

export const LIVE_ENROLLMENT_STATUSES = ["active", "waitlisted"] as const
export type LiveEnrollmentStatus = (typeof LIVE_ENROLLMENT_STATUSES)[number]

/** Whether this enrollment status is a live registration. */
export function isLiveEnrollmentStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "waitlisted"
}

/** The Prisma `in` list for a live-enrollment filter. A fresh array, so no caller can mutate it. */
export function liveEnrollmentStatuses(): LiveEnrollmentStatus[] {
  return [...LIVE_ENROLLMENT_STATUSES]
}
