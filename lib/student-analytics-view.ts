import {
  buildCohortDistribution,
  mergeAssessmentScorePopulation,
  type CohortDistribution,
  type CohortScore,
} from "@/lib/analytics/cohort"
import {
  absoluteLetter,
  gradeBandRanges,
  relativeLetter,
  type RegimeDecision,
  type RelativeLetter,
} from "@/lib/analytics/grading-bands"
import { selectAdaptiveRetakeQuestions } from "@/lib/analytics/retake"

/**
 * Pure shaping for the student analytics page.
 *
 * ## The split, and why it is the same split as everywhere else
 *
 * The page fetches (`lib/student-analytics.ts`), this module decides what each number *is*,
 * and `components/student-analytics.tsx` renders. This repo has no jsdom, so a rule left
 * inside a component has no test at all — the same reason `lib/student-grades.ts` and
 * `lib/teacher-dashboard-view.ts` exist.
 *
 * ## The cohort is **published marks only**, unlike the teacher's
 *
 * `getTeacherAnalyticsOverview` builds its per-assessment cohort by merging finalized quiz
 * attempts with published `Grade` rows (`mergeAssessmentScorePopulation`), because a manual
 * mark has no attempt and the teacher must see both (TN-3 / TL-3). A **student** must not:
 * an unreleased mark is not a student-facing fact, and a class average computed from
 * classmates' unreleased attempts would disclose performance the platform deliberately
 * withholds. So the scores fed to `buildCohortDistribution` here come from
 * `Grade.publishedAt != null` rows only.
 *
 * That is also why the disclosure floor applies. `lib/student-assessments.ts` established
 * `MIN_COHORT_FOR_CLASS_AVERAGE = 3` — with exactly two released marks and one of them the
 * student's own, the other is `2 × average − own`, so the average is invertible. The floor is
 * passed in by the reader (it imports the constant from the module that owns it) rather than
 * redeclared here, so there is one definition of the confidentiality rule.
 *
 * ## Absence is never `0`
 *
 * A mark that does not exist and a mark that has not been released are different states, and
 * neither is zero. `yourMarkState` keeps them apart, an unpublished average stays `null`
 * (never `0`), and `difference` is `null` unless both sides exist. Nothing here averages in a
 * zero for a missing mark.
 */

/** Why a mark cell is empty: released, existing-but-withheld, or not marked yet. */
export type AssessmentMarkState = "released" | "withheld" | "none"

/** One assessment as the reader found it, before the disclosure rule is applied. */
export type ComparisonAssessmentInput = {
  id: string
  title: string
  /** ISO. */
  dueDate: string
  maxMarks: number
  /** Published `Grade` rows for the whole cohort, one score per student. */
  scores: readonly CohortScore[]
  /** The student's own published percentage, or `null`. */
  yourPercentage: number | null
  yourMarkState: AssessmentMarkState
}

/** One assessment's cohort, reduced to what the page shows and can honestly disclose. */
export type AssessmentComparison = {
  assessmentId: string
  title: string
  dueDate: string
  maxMarks: number
  /** The cohort distribution over **published** marks. */
  cohort: CohortDistribution
  /**
   * The disclosed class average, or `null` when there is nothing to disclose — either no
   * published mark at all, or fewer than the minimum cohort. Never a substituted `0`.
   */
  classAverage: number | null
  /** `true` when marks exist but the cohort is below the disclosure floor. */
  classAverageWithheld: boolean
  yourPercentage: number | null
  yourMarkState: AssessmentMarkState
  /** `yourPercentage − classAverage`, or `null` when either side is absent. */
  difference: number | null
}

function roundTo(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * One score per student per assessment, from **published** `Grade` rows only.
 *
 * Reuses `mergeAssessmentScorePopulation` with an empty attempt map, so the "one score per
 * distinct student, deterministically ordered" semantics are the ones the teacher's page
 * already uses rather than a second implementation. Rows whose `maxPoints` cannot produce a
 * percentage are dropped, not zero-filled — a corrupt grade must not drag an average down.
 */
export function publishedScoresByAssessment(
  rows: readonly {
    assessmentId: string
    studentId: string
    points: number
    maxPoints: number
  }[],
): Map<string, CohortScore[]> {
  const percentagesByAssessment = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (!Number.isFinite(row.points) || !Number.isFinite(row.maxPoints) || row.maxPoints <= 0) {
      continue
    }
    const percentage = (row.points / row.maxPoints) * 100
    const byStudent = percentagesByAssessment.get(row.assessmentId)
    if (byStudent) byStudent.set(row.studentId, percentage)
    else percentagesByAssessment.set(row.assessmentId, new Map([[row.studentId, percentage]]))
  }

  const scores = new Map<string, CohortScore[]>()
  for (const [assessmentId, publishedPercentages] of percentagesByAssessment) {
    scores.set(
      assessmentId,
      mergeAssessmentScorePopulation({ attemptPercentages: new Map(), publishedPercentages }),
    )
  }
  return scores
}

/**
 * Apply the disclosure floor and the personal mark to each assessment's cohort.
 *
 * The average is withheld below `minimumCohort` rather than shown with a caveat: a caveat
 * does not un-invert a two-mark average. `cohort` still carries the buckets and count, which
 * are not invertible on their own, so a caller can explain *why* the average is missing.
 */
export function buildAssessmentComparisons(
  input: readonly ComparisonAssessmentInput[],
  minimumCohort: number,
): AssessmentComparison[] {
  return input.map((assessment) => {
    const cohort = buildCohortDistribution(assessment.scores)
    const classAverageWithheld = cohort.count > 0 && cohort.count < minimumCohort
    const classAverage =
      !classAverageWithheld && cohort.count >= minimumCohort ? cohort.average : null
    const difference =
      classAverage !== null && assessment.yourPercentage !== null
        ? roundTo(assessment.yourPercentage - classAverage, 1)
        : null

    return {
      assessmentId: assessment.id,
      title: assessment.title,
      dueDate: assessment.dueDate,
      maxMarks: assessment.maxMarks,
      cohort,
      classAverage,
      classAverageWithheld,
      yourPercentage: assessment.yourPercentage,
      yourMarkState: assessment.yourMarkState,
      difference,
    }
  })
}

/**
 * The assessments the section may render at all.
 *
 * "Only show a section where the data actually exists" — an assessment the student has neither
 * a mark for nor a cohort behind contributes a row of em dashes and an empty chart frame, which
 * reads as a broken page. A withheld personal mark still counts as existing: the student is owed
 * the sentence explaining it is not released.
 */
export function visibleComparisons(rows: readonly AssessmentComparison[]): AssessmentComparison[] {
  return rows.filter((row) => row.cohort.count > 0 || row.yourMarkState !== "none")
}

/** A chart label short enough for the x-axis, without silently dropping the whole title. */
export function chartLabel(title: string, max = 12): string {
  return title.length > max ? `${title.slice(0, max)}…` : title
}

/** `ClassAverageChart` input: the disclosed class average per assessment, rounded for display. */
export function classAverageChartData(
  rows: readonly AssessmentComparison[],
): { label: string; value: number }[] {
  return rows
    .filter(
      (row): row is AssessmentComparison & { classAverage: number } => row.classAverage !== null,
    )
    .map((row) => ({ label: chartLabel(row.title), value: roundTo(row.classAverage) }))
}

/**
 * The one assessment the distribution card charts.
 *
 * The **most recent** assessment that has both a disclosable class average and a released
 * personal mark, so the card can always show a position. A distribution without the student's
 * own mark would be a chart headed "your position" with no position on it, so the card is
 * omitted for a course where nothing satisfies both.
 */
export function focusDistribution(
  rows: readonly AssessmentComparison[],
): AssessmentComparison | null {
  const candidates = rows.filter((row) => row.classAverage !== null && row.yourPercentage !== null)
  if (candidates.length === 0) return null
  return candidates.slice().sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]
}

/** `GradeDistributionChart` input, straight from the distribution's buckets. */
export function distributionChartData(
  cohort: CohortDistribution,
): { grade: string; count: number }[] {
  return cohort.buckets.map((bucket) => ({ grade: bucket.grade, count: bucket.count }))
}

/**
 * The letter a mark falls in, under the course's own resolved regime.
 *
 * This is `resolveRegimeForCourse`'s decision applied to a percentage — it does not decide the
 * regime. Under **relative** grading the bands are the class's `mean ± kσ`; under **absolute**
 * they are VIT's fixed Table-6 ranges. Returns `null` rather than a defaulted letter whenever
 * the bands cannot be computed (a flat cohort, or the top band needing the rank rule), because
 * a defaulted letter looks like a grade.
 */
export function positionLetter(
  percentage: number | null,
  decision: RegimeDecision,
): RelativeLetter | null {
  if (percentage === null || !Number.isFinite(percentage)) return null
  if (decision.regime === "relative") {
    return relativeLetter(percentage, gradeBandRanges(decision.mean, decision.standardDeviation))
  }
  return absoluteLetter(percentage)
}

export type TopicMastery = {
  /** The tag exactly as the question carries it. Never merged, trimmed or folded. */
  topic: string
  totalQuestions: number
  /** Questions the student answered incorrectly or left unanswered. */
  notMasteredCount: number
  /** `0`–`100`, `mastered / totalQuestions`. */
  mastery: number
}

export type TopicMasteryBreakdown = {
  topics: TopicMastery[]
  /** Questions with no tag: counted, but never presented as a topic. */
  untaggedQuestionCount: number
  totalQuestions: number
}

/**
 * Per-topic mastery from the student's own responses, using the retake selection as the rule.
 *
 * ## What this number is, and what it is not
 *
 * `lib/analytics/subtopics.ts` refuses a *cohort* mastery number per tag because
 * `Question.subtopic` is model-generated free text with no controlled vocabulary. This is a
 * different quantity: it is **the student's own answers** on the questions that assessment
 * already carries, so it invents no taxonomy and attributes nothing to a classmate. The tag is
 * grouped by exact string — `slope` and `Slope` stay two topics — and a topic is only listed
 * when it has at least one question, with its own question count shown beside the bar so a
 * one-question topic is visibly thin.
 *
 * ## Why the retake selector decides "not mastered"
 *
 * `selectAdaptiveRetakeQuestions` is the platform's one definition of "a question this student
 * should practise": a wrong answer, or none at all. Mastered is therefore
 * `total − failed − unanswered`, so a skipped question counts as not yet mastered rather than
 * vanishing from the denominator. Reusing the selector means the page and the retake surface
 * cannot disagree about which questions need work.
 *
 * Weakest topic first, then by tag for a stable order.
 *
 * Takes **one entry per assessment** because a course's mastery is aggregated across its quiz
 * sittings: each assessment's own question set and its latest finalized attempt go through the
 * retake selector separately, then the topics are summed. An assessment with no attempt is
 * simply not passed in by the reader — no responses is no evidence, not 0% mastery.
 */
export function buildTopicMastery(input: {
  assessments: readonly {
    questions: readonly { id: string; subtopic: string | null }[]
    responses: readonly { questionId: string; isCorrect: boolean | null }[]
  }[]
}): TopicMasteryBreakdown {
  const byTopic = new Map<string, { total: number; notMastered: number }>()
  let untaggedQuestionCount = 0
  let totalQuestions = 0

  for (const assessment of input.assessments) {
    const selection = selectAdaptiveRetakeQuestions({
      questionIds: assessment.questions.map((question) => question.id),
      responses: assessment.responses,
    })
    const notMastered = new Set([
      ...selection.failedQuestionIds,
      ...selection.unansweredQuestionIds,
    ])

    for (const question of assessment.questions) {
      totalQuestions += 1
      const tag = question.subtopic?.trim() ?? ""
      if (tag === "") {
        untaggedQuestionCount += 1
        continue
      }
      const entry = byTopic.get(tag) ?? { total: 0, notMastered: 0 }
      entry.total += 1
      if (notMastered.has(question.id)) entry.notMastered += 1
      byTopic.set(tag, entry)
    }
  }

  const topics: TopicMastery[] = [...byTopic.entries()].map(([topic, counts]) => ({
    topic,
    totalQuestions: counts.total,
    notMasteredCount: counts.notMastered,
    mastery: roundTo(((counts.total - counts.notMastered) / counts.total) * 100, 1),
  }))

  topics.sort((a, b) => a.mastery - b.mastery || a.topic.localeCompare(b.topic))

  return { topics, untaggedQuestionCount, totalQuestions }
}
