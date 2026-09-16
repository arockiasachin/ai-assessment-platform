import type { StatusKey } from "@/components/ui/status-pill"
import type { StudentPeerEvaluationGroup } from "@/lib/contracts/groups"
import { formatPercent } from "@/lib/format"
import type { StudentAssessmentItem } from "@/lib/student-assessments"

/**
 * Pure view logic for the student dashboard.
 *
 * Same split as `lib/teacher-dashboard-view.ts`: the page fetches, the client
 * component renders, and every decision — what counts as outstanding, what a due
 * label says, which tile shows which number — lives here where a test can reach it.
 * This repo has no jsdom, so logic left in a component has no test at all.
 *
 * ## What the mockup drew that is deliberately absent
 *
 * - **The two KPI sparklines** (`MOCK_SPARKLINES.student`, `.submissions`) need six
 *   weeks of stored history. Nothing snapshots a student's score or submission count,
 *   so the line could only be invented.
 * - **"Round closes"** in the peer section. The mockup read it from a team milestone,
 *   but `StudentPeerEvaluationGroup` carries no milestone or due date, so there is no
 *   real value to render. The section renders only fields the workspace returns.
 *
 * ## A limitation inherited from the reader, stated plainly
 *
 * `listStudentAssessments` does not expose whether an assessment has been released to
 * students, so the mockup's "a draft is not shown" rule on the *Due next* table cannot
 * be reproduced. This module lists every assessment with no submission from the
 * student, past due or not. `/student/assessments` already shows the same rows from
 * the same reader; the gap is not introduced here, and it is reported rather than
 * papered over with a guessed release flag.
 */

export type StudentKpiId = "overall" | "due-this-week" | "submitted" | "peer"

export type StudentDashboardKpi = {
  id: StudentKpiId
  label: string
  value: string
  hint: string
  accent: "primary" | "success" | "warning" | "destructive"
}

/** Mean of the released percentages, or `null` when nothing has been released. */
export function overallAveragePercent(
  assessments: readonly StudentAssessmentItem[],
): number | null {
  let sum = 0
  let count = 0
  for (const assessment of assessments) {
    if (assessment.percentage === null) continue
    sum += assessment.percentage
    count += 1
  }
  if (count === 0) return null
  return sum / count
}

/** How many assessments have a released mark — the population the mean covers. */
export function releasedMarkCount(assessments: readonly StudentAssessmentItem[]): number {
  return assessments.filter((assessment) => assessment.percentage !== null).length
}

/** Work the student has handed in. A saved draft has no `submittedAt`, so it is not counted. */
export function submittedCount(assessments: readonly StudentAssessmentItem[]): number {
  return assessments.filter((assessment) => assessment.submittedAt !== null).length
}

/**
 * Assessments the student still has to submit, soonest first.
 *
 * `dueDate` is ISO, so a string compare sorts chronologically; the copy keeps the
 * caller's array untouched.
 */
export function outstandingAssessments(
  assessments: readonly StudentAssessmentItem[],
): StudentAssessmentItem[] {
  return assessments
    .filter((assessment) => assessment.submittedAt === null)
    .slice()
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
}

/**
 * Outstanding work due within the next seven days.
 *
 * Uses `daysUntilDue`, which the reader computed against the server's clock at fetch
 * time. Reading the clock again here would make the tile disagree with itself between
 * the server render and hydration.
 */
export function dueThisWeek(
  assessments: readonly StudentAssessmentItem[],
  windowDays = 7,
): StudentAssessmentItem[] {
  return assessments.filter(
    (assessment) =>
      assessment.submittedAt === null &&
      assessment.daysUntilDue >= 0 &&
      assessment.daysUntilDue <= windowDays,
  )
}

/** A relative due label derived from the reader's own day count. */
export function dueLabel(assessment: StudentAssessmentItem): string {
  if (assessment.daysUntilDue === 0) return "Due today"
  if (assessment.daysUntilDue === 1) return "Due tomorrow"
  if (assessment.daysUntilDue > 1) return `Due in ${assessment.daysUntilDue} days`
  const overdue = Math.abs(assessment.daysUntilDue)
  return overdue === 1 ? "1 day overdue" : `${overdue} days overdue`
}

export type StudentMarkState = "released" | "withheld" | "none"

/**
 * The three states a student's mark cell can be in.
 *
 * `withheld` is the one that matters: the reader sets `hasMark` but not `published`
 * when a mark exists and has not been released. The value must never be shown, but
 * saying "not marked" would be untrue — so the cell renders a "Mark not released"
 * pill instead of a number.
 */
export function studentMarkState(assessment: StudentAssessmentItem): StudentMarkState {
  if (assessment.percentage !== null) return "released"
  if (assessment.hasMark && !assessment.published) return "withheld"
  return "none"
}

/** Submission state → the shared status vocabulary, so the pill and the list page agree. */
export const SUBMISSION_STATE_TO_STATUS: Record<
  StudentAssessmentItem["submissionState"],
  StatusKey
> = {
  not_submitted: "pending",
  draft: "draft",
  submitted: "submitted",
  resubmitted: "resubmitted",
  graded: "graded",
  late: "late",
}

export const SUBMISSION_STATE_LABEL: Record<StudentAssessmentItem["submissionState"], string> = {
  not_submitted: "Not submitted",
  draft: "Draft",
  submitted: "Submitted",
  resubmitted: "Resubmitted",
  graded: "Graded",
  late: "Late",
}

export type PeerRoundSummary = {
  groupId: string
  groupName: string
  courseCode: string
  /** Every active member, including the student. */
  expected: number
  submitted: number
  outstanding: number
  selfSubmitted: boolean
  /**
   * What the student's received aggregate is right now, in words. Confidentiality is
   * the point of the section, so a withheld aggregate says how many raters count
   * toward disclosure rather than implying a missing value.
   */
  resultsLabel: string
}

export function peerRoundSummaries(
  groups: readonly StudentPeerEvaluationGroup[],
): PeerRoundSummary[] {
  return groups.map((group) => {
    const received = group.received
    const resultsLabel = received.withheld
      ? `Withheld — ${received.ratingCount} of ${received.minRatersRequired} teammates have rated`
      : `Overall ${received.overallAverage.toFixed(1)} / 5 from ${received.ratingCount} ratings`

    return {
      groupId: group.groupId,
      groupName: group.groupName,
      courseCode: group.courseCode,
      expected: group.expectedEvaluations,
      submitted: group.submittedEvaluations,
      outstanding: Math.max(0, group.expectedEvaluations - group.submittedEvaluations),
      selfSubmitted: group.selfEvaluationSubmitted,
      resultsLabel,
    }
  })
}

/** The four tiles, from real payloads. No sparkline and no delta on any of them. */
export function studentDashboardKpis(input: {
  assessments: readonly StudentAssessmentItem[]
  groups: readonly StudentPeerEvaluationGroup[]
}): StudentDashboardKpi[] {
  const overall = overallAveragePercent(input.assessments)
  const released = releasedMarkCount(input.assessments)
  const submitted = submittedCount(input.assessments)
  const total = input.assessments.length
  const due = dueThisWeek(input.assessments)
  const rounds = peerRoundSummaries(input.groups)
  const peerExpected = rounds.reduce((sum, round) => sum + round.expected, 0)
  const peerSubmitted = rounds.reduce((sum, round) => sum + round.submitted, 0)
  const peerOutstanding = rounds.reduce((sum, round) => sum + round.outstanding, 0)

  return [
    {
      id: "overall",
      label: "Overall",
      value: formatPercent(overall),
      hint: overall === null ? "No marks released yet" : `Across ${released} released assessments`,
      accent: "success",
    },
    {
      id: "due-this-week",
      label: "Due this week",
      value: String(due.length),
      hint:
        due.length === 0
          ? "Nothing due in the next 7 days"
          : due.map((assessment) => assessment.title).join(" · "),
      accent: "warning",
    },
    {
      id: "submitted",
      label: "Submitted",
      value: `${submitted} of ${total}`,
      hint: `${total - submitted} not submitted`,
      accent: "primary",
    },
    {
      id: "peer",
      label: "Peer evaluations",
      value:
        rounds.length === 0
          ? "—"
          : peerOutstanding === 0
            ? "All submitted"
            : `${peerOutstanding} to do`,
      hint:
        rounds.length === 0
          ? "No peer evaluation round"
          : rounds.length === 1
            ? `${peerSubmitted} of ${peerExpected} · ${rounds[0].groupName}`
            : `${peerSubmitted} of ${peerExpected} across ${rounds.length} groups`,
      accent: rounds.length > 0 && peerOutstanding === 0 ? "success" : "warning",
    },
  ]
}
