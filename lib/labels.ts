import type { StatusKey } from "@/components/ui/status-pill"
import type {
  AssessmentType,
  ContributionEventType,
  CourseCategory,
  GradeReviewStatus,
  GradeSource,
  GroupStatus,
  MilestoneStatus,
  PeerEvaluationStatus,
  SubmissionStatus,
  TestRunStatus,
} from "@/lib/generated/prisma/enums"

/**
 * Domain → status vocabulary, shared by the mockup pages **and** the real pages.
 *
 * Mapping an enum to a `StatusKey` is a page concern (see
 * `docs/ui/design-system.md` §5), so it lives in `lib/` rather than in the
 * primitive. Nothing in this module fetches or reads the clock; it is pure
 * lookup data plus one tiny helper.
 *
 * This file used to live at `app/mockup/teacher/_lib/labels.ts`. A real page
 * cannot import from the mockup tree, so this module lives in `lib/`; the mockup
 * file is now a re-export shim so the mockup pages keep working unchanged.
 *
 * The keys are the **generated Prisma enums** (`@/lib/generated/prisma/enums`), so
 * a column value indexes these maps directly, with no translation table. They were
 * previously string unions duplicated in `lib/mock/types.ts` — value-identical, but
 * they made the real app depend on the design-reference tree.
 */

/**
 * VIT's course categories.
 *
 * The stored values are the enum; an admin surface must never render them raw, so every
 * category a write can store has a human label here. The array is the canonical order for a
 * `<select>`, so option order does not depend on an object's key order.
 */
export const COURSE_CATEGORY_VALUES = [
  "THEORY",
  "LAB_EMBEDDED_THEORY",
  "LABORATORY",
  "PROJECT",
  "SOFT_SKILLS",
  "EXTRA_CURRICULAR",
  "NGCR",
] as const satisfies readonly CourseCategory[]

export const COURSE_CATEGORY_LABEL: Record<CourseCategory, string> = {
  THEORY: "Theory",
  LAB_EMBEDDED_THEORY: "Lab-embedded theory",
  LABORATORY: "Laboratory",
  PROJECT: "Project",
  SOFT_SKILLS: "Soft skills",
  EXTRA_CURRICULAR: "Extra-curricular",
  // VIT's acronym for a Non-Graded Credit Course; kept alongside the expansion so the label
  // still reads as the term the regulations use.
  NGCR: "Non-graded credit (NGCR)",
}

export const ASSESSMENT_KIND_LABEL: Record<AssessmentType, string> = {
  QUIZ: "Quiz",
  DESCRIPTIVE: "Descriptive",
  CODE: "Code",
  GROUP_PROJECT: "Group project",
  ASSIGNMENT: "Assignment",
}

/**
 * Material kinds. Shared so the mockup and the real resources page cannot drift —
 * `OTHER` is deliberately unreachable in demo data (see `docs/plans/wave-2.md`
 * §2.2) but still needs a label, because the column is nullable-free and a real
 * upload could produce it.
 */
export const MATERIAL_KIND_LABEL: Record<
  "DOCUMENT" | "SLIDE_DECK" | "VIDEO" | "TRANSCRIPT" | "LINK" | "OTHER",
  string
> = {
  DOCUMENT: "Document",
  SLIDE_DECK: "Slide deck",
  VIDEO: "Video",
  TRANSCRIPT: "Transcript",
  LINK: "Link",
  OTHER: "Other",
}

export const REVIEW_STATE_TO_STATUS: Record<GradeReviewStatus, StatusKey> = {
  PENDING: "pending",
  AUTO_ACCEPTED: "graded",
  NEEDS_REVIEW: "needs-review",
  OVERRIDDEN: "overridden",
  REJECTED: "rejected",
}

export const REVIEW_STATE_LABEL: Record<GradeReviewStatus, string> = {
  PENDING: "Pending",
  AUTO_ACCEPTED: "Auto-accepted",
  NEEDS_REVIEW: "Needs review",
  OVERRIDDEN: "Overridden",
  REJECTED: "Rejected",
}

export const SUBMISSION_STATE_TO_STATUS: Record<SubmissionStatus, StatusKey> = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  LATE: "late",
  GRADED: "graded",
  RESUBMITTED: "resubmitted",
}

/**
 * Submission status → label.
 *
 * **These are status words and must match `STATUS_META` in
 * `components/ui/status-pill.tsx`**, which is the vocabulary of record: `GRADED`
 * says "Graded" there, so it says "Graded" here. Do not use "Marked" for a
 * *status* — "marked" is the verb for the act and the noun for the quantity
 * ("Marks: 22.5/30", "Not marked", "3 marked, withheld"), which is a different
 * thing and is why both words exist on the same pages.
 */
export const SUBMISSION_STATE_LABEL: Record<SubmissionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  LATE: "Late",
  GRADED: "Graded",
  RESUBMITTED: "Resubmitted",
}

export const GROUP_STATE_TO_STATUS: Record<GroupStatus, StatusKey> = {
  FORMING: "forming",
  ACTIVE: "active",
  COMPLETED: "completed",
  ARCHIVED: "archived",
}

export const PEER_STATE_TO_STATUS: Record<PeerEvaluationStatus, StatusKey> = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
}

export const MILESTONE_STATE_TO_STATUS: Record<MilestoneStatus, StatusKey> = {
  PLANNED: "queued",
  IN_PROGRESS: "in-progress",
  COMPLETED: "completed",
  MISSED: "missed",
}

export const MILESTONE_STATE_LABEL: Record<MilestoneStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  MISSED: "Missed",
}

/** `TestRunStatus` values are already lowercase `StatusKey`s. */
export const TEST_RUN_STATE_TO_STATUS: Record<TestRunStatus, StatusKey> = {
  QUEUED: "queued",
  RUNNING: "running",
  PASSED: "passed",
  FAILED: "failed",
  ERROR: "error",
  TIMEOUT: "timeout",
}

export const GRADE_SOURCE_LABEL: Record<GradeSource, string> = {
  AI_SUGGESTED: "AI suggested",
  TEACHER_OVERRIDE: "Teacher override",
  AUTO: "Auto-graded",
  IMPORTED: "Imported",
}

export const CONTRIBUTION_KIND_LABEL: Record<ContributionEventType, string> = {
  COMMIT: "Commit",
  PULL_REQUEST: "Pull request",
  ISSUE: "Issue",
  REVIEW: "Review",
  MANUAL: "Manual",
  OTHER: "Other",
}

/** Calendar event kind → tone, so the planner and the dashboards agree. */
export const CALENDAR_KIND_TONE: Record<
  "CLASS" | "ASSESSMENT" | "HOLIDAY" | "REMINDER",
  StatusKey
> = {
  CLASS: "active",
  ASSESSMENT: "published",
  HOLIDAY: "archived",
  REMINDER: "pending",
}

export const CALENDAR_KIND_LABEL: Record<"CLASS" | "ASSESSMENT" | "HOLIDAY" | "REMINDER", string> =
  {
    CLASS: "Class",
    ASSESSMENT: "Assessment",
    HOLIDAY: "Holiday",
    REMINDER: "Reminder",
  }

/** Review priority is a fixture-only field; it gets its own small vocabulary. */
export function priorityToStatus(priority: "high" | "normal" | "low"): StatusKey {
  if (priority === "high") return "flagged"
  if (priority === "low") return "archived"
  return "queued"
}

export const PRIORITY_LABEL: Record<"high" | "normal" | "low", string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
}

/**
 * The threshold the auto-accept flag uses. It mirrors the copy of
 * `grading.auto-accept-high-confidence` in `MOCK_FEATURE_FLAGS`; the reviews and
 * settings pages read it from here so the two never disagree.
 */
export const AUTO_ACCEPT_FLAG = "grading.auto-accept-high-confidence"
export const AUTO_ACCEPT_CONFIDENCE_FLOOR = 0.78

/** Compact labels for the five CATME dimensions, for dense peer-evaluation grids. */
export const CATME_SHORT_LABEL: Record<
  | "contributing"
  | "interacting"
  | "keepingOnTrack"
  | "expectingQuality"
  | "knowledgeSkillsAbilities",
  string
> = {
  contributing: "Contributing",
  interacting: "Interacting",
  keepingOnTrack: "On track",
  expectingQuality: "Expecting quality",
  knowledgeSkillsAbilities: "Knowledge & skills",
}
