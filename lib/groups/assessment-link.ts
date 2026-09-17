/**
 * The single definition of "the groups that belong to this assessment" (TN-49).
 *
 * `Group.assessmentId` is the link between a team and the `GROUP_PROJECT` assessment it
 * exists to do. Two readers ask that question and, until this module existed, each would
 * have written the filter on its own:
 *
 *   - the teacher's group list, narrowed to one assessment's teams; and
 *   - the offering analysis, which must not fold unrelated teams into one project
 *     assessment's grade suggestions.
 *
 * This project has produced a repeated class of bug where a rule is correct on the paths
 * someone considered and missing or divergent on the one they did not, so the filter lives
 * here and nowhere else. `releasedAssessmentWhere()` in `lib/assessment-visibility.ts` is the
 * precedent this follows.
 *
 * **This module deliberately imports nothing.** That keeps it importable from anywhere —
 * including seed-reachable code, which runs under `tsx` and cannot resolve the `server-only`
 * sentinel (`tests/seed-import-graph.test.ts`). Pure data in, pure data out.
 */

/**
 * The Prisma `where` fragment naming the groups linked to one assessment.
 *
 * Returned as a **fresh object per call**, not a shared constant: a caller that spreads the
 * fragment and adds a clause, or mutates the object it was handed, must not be able to change
 * what every other caller sees.
 */
export function groupsForAssessmentWhere(assessmentId: string): { assessmentId: string } {
  return { assessmentId }
}
