/**
 * The single definition of "an assessment a student can see".
 *
 * `Assessment.releasedAt` is the release fact — non-null means the assessment is
 * visible to its students. That rule is read by the student assessment list, the
 * student calendar, the gradebook RSC projection, the written-submission route and
 * both seeds, and until this module existed each of those wrote
 * `releasedAt: { not: null }` itself with a comment asking the next reader to keep
 * the copies identical.
 *
 * A comment cannot enforce that. This project has produced a repeated class of bug
 * where a rule is correct on the paths someone considered and missing or divergent
 * on the one they did not — the `CLOSED` guard on three of five write paths, the
 * resume query that omitted its `kind` scope, the unreleased assessment that stayed
 * submittable while it was hidden from the list. A predicate with five handwritten
 * copies is that shape waiting to happen, so it lives here and nowhere else.
 *
 * Callers spread it into the `where` they need. A caller that also wants an `OR` —
 * a calendar event may hang off no assessment at all, for example — composes it
 * *inside* that `OR` rather than replacing the clause, because those callers are
 * expressing two facts, not a different release rule.
 *
 * **This module deliberately imports nothing.** It is reached from
 * `prisma/seed-courses.ts`, which runs under `tsx`, and `tsx` cannot resolve the
 * `server-only` sentinel, which `tests/seed-import-graph.test.ts` guards. It must
 * therefore stay free of `server-only`, `@/lib/prisma` and every other import:
 * pure data in, pure data out, safe to import from anywhere.
 */

/**
 * The Prisma `where` fragment naming an assessment released to students.
 *
 * Returned as a **fresh object per call**, not a shared constant: a caller that
 * spreads the fragment and overrides a field, or mutates the object it was handed,
 * must not be able to change what every other caller sees.
 */
export function releasedAssessmentWhere(): { releasedAt: { not: null } } {
  return { releasedAt: { not: null } }
}
