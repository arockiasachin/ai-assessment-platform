import { StatusPill } from "@/components/ui/status-pill"
import { formatPoints } from "@/lib/mock"
import type { AssessmentKind, StudentAssessmentRow } from "@/lib/mock"

/** Human label for an `AssessmentKind`, used wherever a row names its type. */
export const ASSESSMENT_KIND_LABEL: Record<AssessmentKind, string> = {
  QUIZ: "Quiz",
  DESCRIPTIVE: "Descriptive",
  CODE: "Code task",
  GROUP_PROJECT: "Group project",
  ASSIGNMENT: "Assignment",
}

/**
 * The mark cell on a student's own rows — shared by the dashboard and the
 * assessments list so the two can never disagree.
 *
 * Three states, and only one of them shows a number:
 *  - the mark is released        → "18 / 20";
 *  - the mark exists but is not  → a `StatusPill`, never the number, because a
 *    released                      student must not read a mark their teacher
 *                                  has not published;
 *  - no mark recorded yet       → an em dash fraction from `formatPoints`.
 */
export function StudentMark({ row }: { row: StudentAssessmentRow }) {
  if (row.points !== null && !row.published) {
    return <StatusPill status="pending" label="Mark not released" />
  }

  if (row.points === null) {
    return (
      <span className="font-mono tabular-nums text-muted-foreground">
        {formatPoints(null, row.maxPoints)}
      </span>
    )
  }

  return <span className="font-mono tabular-nums">{formatPoints(row.points, row.maxPoints)}</span>
}

/**
 * Feedback is only readable once the mark is released — a comment written for an
 * unpublished mark is not the student's to read yet.
 */
export function StudentFeedback({ row }: { row: StudentAssessmentRow }) {
  if (row.feedback === null) {
    return <span className="text-xs text-muted-foreground">No feedback yet</span>
  }

  if (!row.published) {
    return (
      <span className="text-xs text-muted-foreground">Withheld until the mark is released</span>
    )
  }

  return <span className="text-xs text-muted-foreground text-pretty">{row.feedback}</span>
}
