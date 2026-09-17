import { formatDateTime } from "@/lib/format"

/**
 * Pure view state for the assessment-release control (TN-1 / TN-31).
 *
 * Release is **one-way in this product**: `POST /api/teacher/assessments/[id]/release`
 * stamps `Assessment.releasedAt`, and there is no route that clears it. The service is
 * deliberately idempotent — a repeat click leaves the original instant alone — so the UI
 * must not offer an affordance it cannot honour. Once an assessment is released, the only
 * thing left to render is the state itself, and the confirmation copy says the action
 * cannot be undone rather than implying an undo exists.
 *
 * This lives here rather than in the control component because the repo has no jsdom, so
 * anything left inside a client component has no test — and the one-way rule is exactly
 * what needs pinning.
 */

export type AssessmentReleaseState = {
  released: boolean
  /** ISO instant, or null. Only read when `released` is true. */
  releasedAt: string | null
}

export type AssessmentReleaseView = {
  /** Status-pill key: `published` reads as visible, `draft` as hidden. */
  status: "published" | "draft"
  label: string
  /** The line under the pill — what the state means for students. */
  detail: string
  /** Whether to render the Release button. False once released: there is no unrelease path. */
  canRelease: boolean
}

export function assessmentReleaseView(state: AssessmentReleaseState): AssessmentReleaseView {
  if (state.released) {
    return {
      status: "published",
      label: "Released",
      detail:
        state.releasedAt === null
          ? "Visible to students"
          : `Visible to students since ${formatDateTime(state.releasedAt)}`,
      canRelease: false,
    }
  }
  return {
    status: "draft",
    label: "Not released",
    detail: "Hidden from students",
    canRelease: true,
  }
}

/**
 * The confirmation body shown before the one-way write.
 *
 * It names both the consequence and the absence of an undo in the same breath, because
 * "releasing cannot be undone" is the fact a teacher needs *before* the button, not after.
 */
export const RELEASE_CONFIRMATION_BODY =
  "Students will see this assessment on their calendar and it becomes available to them immediately. " +
  "Releasing cannot be undone — there is no unrelease action in this product."
