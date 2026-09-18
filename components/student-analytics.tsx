import { AlertTriangle, BarChart3, Info } from "lucide-react"

import { ClassAverageChart, GradeDistributionChart, TrendChart } from "@/components/charts"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPercent } from "@/lib/format"
import { catStatusLabel } from "@/lib/grading/policy-view"
import type { StudentAnalytics, StudentAnalyticsCourse } from "@/lib/student-analytics"
import {
  classAverageChartData,
  distributionChartData,
  type AssessmentComparison,
} from "@/lib/student-analytics-view"
import type { StudentCourseOutcome } from "@/lib/student-course-outcome"
import { ARREAR_REASON_LABEL, OUTCOME_LABEL } from "@/lib/student-outcome-view"
import { cohortTrendPoints, hasTrendData } from "@/lib/teacher-dashboard-view"

/**
 * The student analytics page body.
 *
 * Server Component: the reader has already run, and every child that needs
 * interactivity (`ProgressBar`, the three Recharts charts) is its own client island.
 * Nothing here fetches, so the first paint is populated.
 *
 * ## Only a section with data renders
 *
 * Each card is gated on the thing it charts existing — a course with no released
 * cohort marks gets no empty chart frame, and a course with no graded quiz sitting
 * gets no zeroed mastery bars. The gates are stated at the call site rather than
 * buried in the chart so the omission is auditable.
 *
 * ## Whose line is it
 *
 * The trend card names the cohort, and the page header says outright that the
 * platform stores no history of a student's own scores. A personal sparkline would
 * have to be invented (`lib/student-dashboard-view.ts`), so there is none — the
 * cohort's weekly mean is real and is labelled as the cohort's.
 */

export function StudentAnalyticsView({ analytics }: { analytics: StudentAnalytics }) {
  if (analytics.courses.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No courses to analyse yet"
        description="Analytics appears once you are enrolled in a course. Each course reports on its own cohort — the students in that class, not just you."
      />
    )
  }

  return (
    <div className="space-y-8">
      {analytics.courses.map((course) => (
        <CourseAnalytics
          key={course.offeringId}
          course={course}
          minimumCohort={analytics.minimumCohort}
        />
      ))}
    </div>
  )
}

/*
 * The verdict copy comes from `lib/student-outcome-view.ts`, the same map the Grades page
 * renders. A local copy here had drifted to "Pass"/"Fail"/"Not judged yet" against the
 * shared "Passed"/"Failed"/"Not judged", so one course could read two ways on two pages.
 */

function CourseAnalytics({
  course,
  minimumCohort,
}: {
  course: StudentAnalyticsCourse
  minimumCohort: number
}) {
  const chartData = classAverageChartData(course.comparisons)
  const trendHasData = hasTrendData(course.trend.series)
  const topics = course.topics?.topics ?? []

  return (
    <section className="space-y-4" aria-labelledby={`course-${course.offeringId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id={`course-${course.offeringId}`} className="text-lg font-semibold tracking-tight">
            {course.courseCode} · {course.courseName}
          </h2>
          <p className="text-xs text-muted-foreground">
            {course.term} {course.academicYear}
            {course.ended ? " · completed" : " · in progress"}
          </p>
        </div>
        <Badge variant="outline">
          {course.regime.regime === "relative" ? "Relative bands" : "Absolute bands"}
        </Badge>
      </div>

      <Callout tone={course.regimeNote.tone} title={course.regimeNote.title} icon={Info}>
        <p className="text-muted-foreground">{course.regimeNote.detail}</p>
      </Callout>

      <div className="grid gap-4 lg:grid-cols-2">
        <OutcomeCard course={course} />

        {course.comparisons.length > 0 && (
          <SectionCard
            title="Your marks against the class"
            description="Every average here counts released marks only. A mark that has not been released is never counted, and never counted as zero."
          >
            {chartData.length > 0 ? (
              <>
                <ClassAverageChart data={chartData} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Class average of released marks, per assessment.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No assessment in this course has enough released marks to publish a class average
                yet. Your own marks are listed below.
              </p>
            )}
            <ComparisonTable rows={course.comparisons} minimumCohort={minimumCohort} />
          </SectionCard>
        )}

        {course.distribution !== null && (
          <SectionCard
            title="Score distribution and your position"
            description={`Released marks for ${course.distribution.title}, binned on VIT's absolute Table-6 scale. A VIT letter is awarded for a course grand total, not for one assessment.`}
          >
            <GradeDistributionChart data={distributionChartData(course.distribution.cohort)} />
            <p className="mt-2 text-xs text-muted-foreground">
              {course.distribution.cohort.count} released mark
              {course.distribution.cohort.count === 1 ? "" : "s"} · class average{" "}
              {formatPercent(course.distribution.classAverage, 1)} · your mark{" "}
              {formatPercent(course.distribution.yourPercentage, 1)}
              {course.distributionLetter !== null
                ? ` — band ${course.distributionLetter} on this scale`
                : ""}
              .
            </p>
          </SectionCard>
        )}

        {trendHasData && course.trend.series !== null && (
          <SectionCard
            title="Cohort trend across the term"
            description="The class's mean score by teaching week. This is the cohort's line, not a history of your own scores — the platform stores no record of your own score over time."
          >
            <TrendChart data={cohortTrendPoints(course.trend.series)} />
            <p className="mt-2 text-xs text-muted-foreground">
              {course.trend.series.weeks} teaching weeks · {course.trend.markedCount} released
              marks. A week with no assessed work is left blank.
            </p>
          </SectionCard>
        )}

        {topics.length > 0 && (
          <SectionCard
            title="Topic mastery"
            description="Your own answers on each topic across your graded quiz sittings in this course, weakest first. A topic with one question is one question of evidence."
          >
            <ul className="space-y-4">
              {topics.map((topic) => (
                <li key={topic.topic}>
                  <ProgressBar
                    value={topic.mastery}
                    max={100}
                    label={`${topic.topic} · ${topic.totalQuestions} question${topic.totalQuestions === 1 ? "" : "s"}`}
                    valueText={`${topic.mastery}%`}
                    tone={
                      topic.mastery >= 80 ? "success" : topic.mastery >= 50 ? "primary" : "warning"
                    }
                  />
                </li>
              ))}
            </ul>
            {course.topics !== null && course.topics.untaggedQuestionCount > 0 && (
              <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {course.topics.untaggedQuestionCount} question
                  {course.topics.untaggedQuestionCount === 1 ? "" : "s"} carry no topic tag and are
                  not shown as a topic.
                </span>
              </p>
            )}
          </SectionCard>
        )}
      </div>
    </section>
  )
}

/** The per-course verdict, the weighted total and the FAT/CAT state from the outcome reader. */
function OutcomeCard({ course }: { course: StudentAnalyticsCourse }) {
  const outcome = course.outcome

  return (
    <SectionCard
      title="Course outcome"
      description="The course verdict, the weighted total and the final assessment, from the same reader the Grades page will use."
    >
      {outcome === null ? (
        <p className="text-sm text-muted-foreground">
          This course&apos;s outcome could not be read right now, so nothing is claimed about it.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                outcome.outcome.status === "pass"
                  ? "default"
                  : outcome.outcome.status === "fail"
                    ? "destructive"
                    : "outline"
              }
            >
              {OUTCOME_LABEL[outcome.outcome.status]}
            </Badge>
            {outcome.arrear !== null && (
              <Badge variant="destructive">
                {/* The shared map, so this matches the Arrears and Grades pages exactly. */}
                {ARREAR_REASON_LABEL[outcome.arrear]}
              </Badge>
            )}
          </div>

          <dl className="grid gap-2 sm:grid-cols-2">
            <OutcomeStat label="Grand total" value={formatPercent(outcome.grandTotal, 1)} />
            <OutcomeStat
              label={`Course letter (${course.regime.regime} bands)`}
              value={course.grandTotalLetter ?? "—"}
              hint={
                course.grandTotalLetter === null
                  ? "The weighted total is not known yet, so no letter is stated."
                  : undefined
              }
            />
            <OutcomeStat
              label="Final assessment"
              value={finalAssessmentValue(outcome)}
              hint={outcome.finalAssessment?.title ?? undefined}
            />
            <OutcomeStat label="CAT progress" value={catProgressValue(outcome)} />
          </dl>

          {outcome.arrear === "failed" && (
            <Callout tone="destructive" title="Outstanding arrear" icon={AlertTriangle}>
              <p>
                You did not pass the final assessment for this course. Your analytics below still
                show your own work and this cohort&apos;s marks.
              </p>
            </Callout>
          )}
          {outcome.arrear === "did-not-appear" && (
            <Callout tone="warning" title="No final assessment on record" icon={AlertTriangle}>
              <p>
                This course has ended and no final-assessment mark was published for you. That is
                recorded as a missing final assessment, not as a zero.
              </p>
            </Callout>
          )}
          {outcome.outcome.status === "fail" && outcome.outcome.reason === "fat-ineligible" && (
            <Callout tone="warning" title="CAT requirement not met" icon={AlertTriangle}>
              <p>
                Your CAT average is {formatPercent(outcome.outcome.catPercent, 1)}, below this
                course&apos;s minimum of {formatPercent(outcome.outcome.minimum, 0)}. The final
                assessment cannot be counted, so the course is not passed.
              </p>
            </Callout>
          )}
          {outcome.outcome.status === "not-judged" && (
            <p className="text-sm text-muted-foreground">
              {outcome.outcome.reason === "insufficient-cat-work"
                ? "The CAT pool is still being marked, so this course has no verdict yet."
                : "No weighted total can be stated yet — usually because the final assessment has no released mark."}
            </p>
          )}
        </div>
      )}
    </SectionCard>
  )
}

function OutcomeStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function finalAssessmentValue(outcome: StudentCourseOutcome): string {
  if (outcome.finalAssessment === null) return "None identified"
  if (!outcome.finalAssessment.published) return "Not released"
  return formatPercent(outcome.finalAssessment.percentage, 1)
}

/**
 * The CAT gate in words.
 *
 * `catStatusLabel` comes from `lib/grading/policy-view.ts` — the same map the teacher
 * surfaces use. A local copy here declared the *same constant name* with different
 * strings ("Requirement met" vs "Eligible for FAT") and lacked the library's fallback, so
 * an unrecognised status rendered blank instead of showing itself.
 */
function catProgressValue(outcome: StudentCourseOutcome): string {
  if (outcome.cat.status === "no-cat-gate") return catStatusLabel("no-cat-gate")
  return `${outcome.cat.markedCount} of ${outcome.cat.totalCount} marked · ${catStatusLabel(outcome.cat.status)}`
}

/** The per-assessment table: your released mark, the disclosed average, and the gap. */
function ComparisonTable({
  rows,
  minimumCohort,
}: {
  rows: readonly AssessmentComparison[]
  minimumCohort: number
}) {
  return (
    <div className="mt-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Assessment</TableHead>
            <TableHead>Your mark</TableHead>
            <TableHead>Class average</TableHead>
            <TableHead>Difference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.assessmentId}>
              <TableCell className="max-w-[16rem] truncate">{row.title}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.yourMarkState === "released"
                  ? formatPercent(row.yourPercentage, 1)
                  : row.yourMarkState === "withheld"
                    ? "Not released"
                    : "—"}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.classAverage !== null ? (
                  formatPercent(row.classAverage, 1)
                ) : row.classAverageWithheld ? (
                  <span className="font-sans text-xs text-muted-foreground">
                    Withheld — fewer than {minimumCohort} released marks
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {formatDifference(row.difference)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Signed, one decimal, em dash when either side is missing. `0` carries no sign. */
function formatDifference(value: number | null): string {
  if (value === null) return "—"
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return "0"
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}`
}

/** The page header note. Exported so the page and a test can share one string. */
export const ANALYTICS_SCOPE_NOTE =
  "Every chart on this page is your cohort's, except Topic mastery, which is your own answers. The platform stores no history of your own scores, so there is no personal trend line here — a sparkline of your own marks over time would have to be invented. A blank where a number would be means the number does not exist or has not been released, never zero."
