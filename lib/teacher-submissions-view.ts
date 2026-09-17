import type { AssessmentType } from "@/lib/generated/prisma/client"
import type { TeacherSubmissionRow } from "@/lib/teacher-submissions"

/**
 * Pure view logic for the submissions grading editor.
 *
 * ## Why this module exists
 *
 * The editor used to fetch its rows from `GET /api/teacher/assessments/submissions` on mount — the
 * P2 finding in `docs/quality/a11y-perf-audit.md` — so the page painted empty and then filled in.
 * The sibling `student/assessments` view was converted during the Wave 1 port; this one renders
 * *inside* another component, so it needed the rows threaded through two levels instead of a
 * page-level payload, which is why it was deferred.
 *
 * It now takes `listSubmissionsForTeacher`'s rows as a prop. The two projections were **not**
 * identical, so the mapping between them is the substance of the change and lives here, where it can
 * be tested without a DOM — this repository pins `vitest.config.mts` to `environment: "node"`.
 *
 * ## The one behavioural difference, made explicit
 *
 * The route the editor used to call filtered its grades to **published only**, so an
 * unreleased mark showed as "not marked". `listSubmissionsForTeacher` deliberately selects grades
 * *without* that filter, because the submissions **queue** needs to tell "not marked" apart from
 * "marked, withheld".
 *
 * This mapper **preserves the editor's existing behaviour** — `score` is the mark only when it has
 * been released — so the refactor does not silently start showing withheld marks on a grading
 * screen. The reader's `published` flag is carried through, so that distinction can be surfaced
 * deliberately later rather than as a side effect of this change.
 */

export type SubmissionEditorItem = {
  id: string
  status: string
  contentText: string | null
  submittedAt: string | null
  gradedAt: string | null
  feedback: string | null
  student: {
    id: string
    fullName: string
    registerNumber: string
    email: string
  }
  assessment: {
    id: string
    title: string
    type: AssessmentType
    dueDate: string
    maxMarks: number
    courseCode: string
    courseName: string
    className: string
  }
  score: number | null
  /** Whether the mark has been released. Not rendered today; see the module docblock. */
  published: boolean
}

/**
 * A server row into the editor's item shape.
 *
 * `registerNumber` is `string | null` on the row and `string` here because the editor renders it
 * inside a parenthesised suffix; a null would print "()" rather than an em dash, so it is normalised
 * to the row's name-only case by the caller's template. Kept as `string` with an empty fallback so
 * the render site does not have to branch.
 */
export function toSubmissionEditorItem(row: TeacherSubmissionRow): SubmissionEditorItem {
  return {
    id: row.id,
    status: row.state,
    contentText: row.contentText,
    submittedAt: row.submittedAt,
    gradedAt: row.gradedAt,
    feedback: row.feedback,
    student: {
      id: row.studentId,
      fullName: row.studentName,
      registerNumber: row.registerNumber ?? "",
      email: row.studentEmail,
    },
    assessment: {
      id: row.assessmentId,
      title: row.assessmentTitle,
      type: row.kind,
      dueDate: row.dueDate,
      maxMarks: row.maxPoints,
      courseCode: row.courseCode,
      courseName: row.courseName,
      className: row.className,
    },
    // Released only, matching the route this replaced.
    score: row.published ? row.points : null,
    published: row.published,
  }
}

/**
 * The value an editor input shows when the teacher has not typed into it.
 *
 * Read straight from the row rather than copied into state on mount, which is what lets the rows
 * come from props and a `router.refresh()` after a save update the view without an effect syncing
 * props into state — the cascading-render pattern this repo lints as
 * `react-hooks/set-state-in-effect`.
 */
export function scoreDraftValue(item: SubmissionEditorItem, draft: string | undefined): string {
  if (draft !== undefined) return draft
  return item.score === null ? "" : String(item.score)
}

/** The same, for the feedback box. */
export function feedbackDraftValue(item: SubmissionEditorItem, draft: string | undefined): string {
  return draft !== undefined ? draft : (item.feedback ?? "")
}

/** What the editor shows for the submission body. Never an empty string. */
export function submissionBodyText(item: SubmissionEditorItem): string {
  return item.contentText?.trim() || "No text submitted."
}

/**
 * The DOM id a submission's card carries in the grading editor.
 *
 * The submissions queue's per-row "Open" links here as a fragment, so the browser lands on
 * the clicked submission in `/teacher/assignments` rather than on the top of a page that
 * renders every submission (TN-38). Shared by the link and the card so the two cannot drift.
 */
export function submissionAnchorId(submissionId: string): string {
  return `submission-${submissionId}`
}

export type SubmissionSaveBody = {
  submissionId: string
  /** Absent when the score field was not edited — the route leaves status untouched. */
  score?: number | null
  feedback: string
}

/**
 * Build the `PUT /api/teacher/assessments/submissions` body for one save (TN-45).
 *
 * Only an **edited** score is sent. The previous client always sent `score`, and an empty
 * field validated to `score: null`, so saving feedback alone was read by the route as an
 * explicit un-grade: a `LATE` submission became `SUBMITTED` with its flag destroyed, and a
 * `DRAFT` became `SUBMITTED` with `submittedAt` still null. Omitting the key is what the
 * route's partial-update semantics read as "leave the status alone" — an explicit `null`
 * remains the deliberate "clear this mark" action.
 */
export function buildSubmissionSaveBody(input: {
  submissionId: string
  /** `undefined` means the teacher never touched the score field. */
  scoreDraft: string | undefined
  feedbackDraft: string | undefined
  item: SubmissionEditorItem
}): { ok: true; body: SubmissionSaveBody } | { ok: false; message: string } {
  const body: SubmissionSaveBody = {
    submissionId: input.submissionId,
    feedback: feedbackDraftValue(input.item, input.feedbackDraft),
  }
  if (input.scoreDraft !== undefined) {
    const validation = validateScoreInput(input.scoreDraft, input.item.assessment.maxMarks)
    if (!validation.ok) return { ok: false, message: validation.message }
    body.score = validation.score
  }
  return { ok: true, body }
}

/**
 * Whether a typed score is acceptable before it is sent.
 *
 * Returns `null` for an empty field, which means "clear the mark" and is a legitimate submission
 * rather than an error — the distinction the route's `PUT` also draws by accepting `score: null`.
 * A non-empty value must be a finite number within the assessment's ceiling.
 */
export type ScoreValidation = { ok: true; score: number | null } | { ok: false; message: string }

export function validateScoreInput(raw: string, maxMarks: number): ScoreValidation {
  if (raw.trim() === "") return { ok: true, score: null }

  const score = Number(raw)
  if (!Number.isFinite(score)) return { ok: false, message: "Enter a number." }
  if (score < 0) return { ok: false, message: "A mark cannot be negative." }
  if (score > maxMarks) {
    return { ok: false, message: `Score must be between 0 and ${maxMarks}.` }
  }
  return { ok: true, score }
}
