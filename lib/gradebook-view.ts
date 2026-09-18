import type { Assessment, Student } from "@/lib/gradebook"

/**
 * Testable display logic for the marks grid.
 *
 * The grid used to render the *union* of every student and every assessment across every
 * offering a teacher owns, so the two axes did not belong to the same class: `dsa.teacher`
 * saw 25 students × 14 assessments with 16 of the 25 not enrolled in a given assessment's
 * offering, and every cross-offering cell was refused by the write path (TN-47). These
 * functions narrow both axes to one offering, and mirror the server's mark rules so the
 * client refuses what the server refuses instead of silently repairing it.
 *
 * Pure on purpose: the repo's convention for display logic that needs a test is a `lib/*-view.ts`
 * module with no React and no database, so this needs no component-testing stack.
 */

export type GradebookScope = {
  students: Student[]
  assessments: Assessment[]
}

/**
 * Narrow a gradebook payload to a single offering.
 *
 * - assessments: those delivered by the offering.
 * - students: those **enrolled in** the offering. A student is only in scope when the payload
 *   says so (`offeringIds`); a payload that does not annotate enrolments cannot be scoped and
 *   yields no students, which is the honest empty state rather than the old cross-product.
 * - no offering selected: empty. An unscoped grid is the defect, so silence is preferred to a
 *   guess.
 *
 * The result is rectangle-safe: every remaining cell is (a student enrolled in the offering) ×
 * (an assessment of the offering), which is exactly the set the server will accept.
 */
export function scopeGradebookToOffering(
  students: Student[],
  assessments: Assessment[],
  offeringId: string | null,
): GradebookScope {
  if (!offeringId) return { students: [], assessments: [] }
  return {
    students: students.filter((student) => (student.offeringIds ?? []).includes(offeringId)),
    assessments: assessments.filter((assessment) => assessment.offeringId === offeringId),
  }
}

export type MarkDraftParse = { ok: true; score: number | null } | { ok: false; message: string }

/**
 * Parse one mark cell's draft the way the mark endpoint does.
 *
 * The two refusals are not cosmetic: they are the server's own rules, copied here so the UI
 * stops disagreeing with the write path.
 *
 * - empty → `null`, the server's explicit "clear this mark" (it deletes the grade).
 * - non-numeric (`abc`) → refused with the route's message. It must not be coerced to `null`:
 *   `JSON.stringify({ score: NaN })` serialises as `null`, so forwarding a NaN would clear a
 *   real mark instead of doing nothing.
 * - negative or above `maxMarks` (`9999`) → refused with the service's message. The old cell
 *   clamped to `maxMarks`, so the teacher saw a value the server had never accepted as sent.
 */
export function parseMarkDraft(draft: string, maxMarks: number): MarkDraftParse {
  const trimmed = draft.trim()
  if (trimmed === "") return { ok: true, score: null }

  const score = Number(trimmed)
  if (!Number.isFinite(score)) return { ok: false, message: "Invalid score." }
  if (score < 0 || score > maxMarks) {
    return { ok: false, message: `Score must be between 0 and ${maxMarks}.` }
  }
  return { ok: true, score }
}
