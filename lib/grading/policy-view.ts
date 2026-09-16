import type { OfferingGradingResponse, OfferingGradingConfigValue } from "@/lib/contracts/courses"
import type { StatusKey } from "@/components/ui/status-pill"

/**
 * Pure view logic for the offering grading-policy editor.
 *
 * ## Why this module exists
 *
 * The editor (`components/offering-grading-policy.tsx`) was shipped without a test, because this
 * repository deliberately has no DOM test environment — `vitest.config.mts` pins
 * `environment: "node"` and every viewer page keeps its logic here in a pure module alongside it
 * (`lib/materials-view.ts`, `lib/planner-view.ts`, `lib/calendar-view.ts`, `lib/observability-view.ts`).
 *
 * That is a reasonable trade, but it means the arithmetic and the validation in a form are
 * untested unless they are extracted. For this editor that mattered more than most: it writes a
 * value that changes **every student's final grade**, and the two things most likely to be wrong
 * are exactly the two things that are pure — turning a payload into form state, and turning form
 * state back into a request body.
 *
 * The component now holds only rendering and the fetch; everything below is asserted directly.
 */

/** The editor's form state. Every field is a string because every field is an `<input>`. */
export type GradingDraft = {
  catWeight: string
  fatWeight: string
  /** `""` means "derive the FAT from due dates", which the API takes as `null`. */
  finalAssessmentId: string
  minimumCatPercent: string
  /** When true the gate is disabled and the API receives `null`. */
  gateDisabled: boolean
}

/** The default the editor prefills for a never-configured offering. Mirrors the code defaults. */
export const DEFAULT_DRAFT_CAT = 40
/** See `DEFAULT_DRAFT_CAT`. */
export const DEFAULT_DRAFT_FAT = 60
/** See `DEFAULT_DRAFT_CAT`. */
export const DEFAULT_DRAFT_MINIMUM_CAT = 30

/**
 * A stored payload into form state.
 *
 * The `null` handling is the part worth testing: `minimumCatPercent` is nullable and `null` is
 * meaningful — it means "this course has no CAT gate", which is different from "the gate is at
 * zero". A round trip through the form must not turn one into the other, so a disabled gate is
 * held as `gateDisabled` plus a placeholder number that is never sent.
 */
export function toGradingDraft(payload: OfferingGradingResponse): GradingDraft {
  return {
    catWeight: String(payload.config.catWeight),
    fatWeight: String(payload.config.fatWeight),
    finalAssessmentId: payload.config.finalAssessmentId ?? "",
    minimumCatPercent:
      payload.config.minimumCatPercent === null
        ? String(DEFAULT_DRAFT_MINIMUM_CAT)
        : String(payload.config.minimumCatPercent),
    gateDisabled: payload.config.minimumCatPercent === null,
  }
}

/**
 * The request body for a draft, or the reason it cannot be sent.
 *
 * Returns a union rather than throwing or returning a partial body, so the caller has one branch to
 * render and cannot accidentally send an invalid policy. The sum-to-100 rule is enforced here as
 * well as in the contract: the contract's rejection is a round trip, and a teacher should see the
 * reason next to the field.
 *
 * **The `""` and `null` cases are different.** An empty `finalAssessmentId` means "derive it", which
 * is `null`; a blank `minimumCatPercent` with the gate disabled is also `null`, but an *enabled* gate
 * with a blank field is an error rather than a silent zero — a gate at zero passes everyone while
 * reading as a configured rule.
 */
export type DraftValidation =
  { ok: true; body: OfferingGradingConfigValue } | { ok: false; message: string }

export function gradingDraftToRequest(draft: GradingDraft): DraftValidation {
  const cat = Number(draft.catWeight)
  const fat = Number(draft.fatWeight)

  if (draft.catWeight.trim() === "" || draft.fatWeight.trim() === "") {
    return { ok: false, message: "CAT and FAT weights are both required." }
  }
  if (!Number.isFinite(cat) || !Number.isFinite(fat)) {
    return { ok: false, message: "CAT and FAT weights must be numbers." }
  }
  if (cat < 0 || cat > 100 || fat < 0 || fat > 100) {
    return { ok: false, message: "CAT and FAT weights must be between 0 and 100." }
  }
  if (!weightsSumTo100(draft)) {
    return { ok: false, message: "CAT and FAT weights must sum to 100." }
  }

  let minimumCatPercent: number | null = null
  if (!draft.gateDisabled) {
    const minimum = draft.minimumCatPercent.trim()
    if (minimum === "") {
      return {
        ok: false,
        message: "Enter a minimum CAT score, or tick that the course has no gate.",
      }
    }
    const parsed = Number(minimum)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false, message: "The minimum CAT score must be between 0 and 100." }
    }
    minimumCatPercent = parsed
  }

  return {
    ok: true,
    body: {
      catWeight: cat,
      fatWeight: fat,
      finalAssessmentId: draft.finalAssessmentId === "" ? null : draft.finalAssessmentId,
      minimumCatPercent,
    },
  }
}

/** Whether the two weights sum to 100, to the tolerance the API's schema uses. */
export function weightsSumTo100(draft: GradingDraft): boolean {
  const cat = Number(draft.catWeight)
  const fat = Number(draft.fatWeight)
  if (!Number.isFinite(cat) || !Number.isFinite(fat)) return false
  return Math.abs(cat + fat - 100) < 0.001
}

/** `40 + 60`, or `NaN` when a field is unparseable — the caller decides how to show that. */
export function weightSum(draft: GradingDraft): number {
  return Number(draft.catWeight) + Number(draft.fatWeight)
}

/**
 * The one-line status under the heading.
 *
 * Three distinct states, and the middle one is the important one: an offering with nothing stored
 * is **not** running the displayed default, and saying so in the summary is what stops a teacher
 * assuming the numbers are already in force.
 */
export function gradingPolicySummary(payload: OfferingGradingResponse | null): string {
  if (payload === null) return "CAT / FAT weights and the FAT gate."
  if (payload.usingDefaults) return "Not set — the export weights every assessment equally."
  return `CAT ${payload.config.catWeight}% / FAT ${payload.config.fatWeight}%`
}

/**
 * A student's eligibility verdict as a label and a pill status.
 *
 * `insufficient-cat-work` is mapped to `insufficient-data` rather than to a failure colour on
 * purpose: the verdict is about the *marking*, not the student, and colouring it like a failure
 * would tell a student they are failing when the truth is that marking is unfinished.
 */
export const CAT_STATUS_LABEL: Record<string, string> = {
  eligible: "Eligible for FAT",
  "below-cat-minimum": "Below CAT minimum",
  "insufficient-cat-work": "Too little marked",
  "no-cat-gate": "No CAT gate",
}

export const CAT_STATUS_PILL: Record<string, StatusKey> = {
  eligible: "passed",
  "below-cat-minimum": "failed",
  "insufficient-cat-work": "insufficient-data",
  "no-cat-gate": "draft",
}

/** The pill status for a verdict, falling back rather than rendering `undefined`. */
export function catStatusPill(status: string): StatusKey {
  return CAT_STATUS_PILL[status] ?? "pending"
}

/** The label for a verdict, falling back to the raw value so an unknown one is visible, not blank. */
export function catStatusLabel(status: string): string {
  return CAT_STATUS_LABEL[status] ?? status
}

/**
 * The CAT percentage for display, or an em dash.
 *
 * `null` is a real state — nothing in the pool is marked — and it must not render as `0`, which
 * would read as a student who scored nothing.
 */
export function catPercentLabel(percent: number | null): string {
  return percent === null ? "—" : `${percent}%`
}
