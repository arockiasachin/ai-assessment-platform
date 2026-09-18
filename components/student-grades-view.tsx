import Link from "next/link"
import { GraduationCap } from "lucide-react"

import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { EmptyState } from "@/components/ui/empty-state"
import { InfoHint } from "@/components/ui/info-hint"
import { SectionCard } from "@/components/ui/section-card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPercent } from "@/lib/format"
import type { StudentCourseOutcome } from "@/lib/student-course-outcome"
import {
  ARREAR_REASON_LABEL,
  OUTCOME_LABEL,
  outcomeExplanation,
  summariseOutcomes,
  type OutcomeStatus,
} from "@/lib/student-outcome-view"

export type StudentGradesViewProps = {
  /** Completed courses only, newest first. */
  completed: StudentCourseOutcome[]
}

/** The verdict as a status chip. `not-judged` is the neutral "insufficient data" tone. */
const OUTCOME_STATUS_KEY: Record<OutcomeStatus, StatusKey> = {
  pass: "passed",
  fail: "failed",
  "not-judged": "insufficient-data",
}

const LINK_CLASS =
  "rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"

/**
 * Grades — completed courses.
 *
 * The transcript: for every course the student has finished, the verdict
 * `evaluateCourseOutcome` reached, the weighted grand total behind it, and the term it
 * was taken in. Current-term marks are deliberately absent — they are on
 * `/student/marks` — so the two pages never show the same rows.
 *
 * The distinction this page exists to render:
 *
 * - **`not-judged` is not `fail`.** A verdict of `not-judged` gets its own dashed,
 *   muted chip reading "Not judged", and an explanation that names the missing evidence.
 *   A failed course gets the red "Failed" chip. Nothing maps one onto the other.
 * - **A missing total is `—`.** `grandTotal` is `null` whenever the final assessment has
 *   no published mark; the cell shows an em dash, never a `0`, so an incomplete record
 *   never reads as a zero score.
 * - **An arrear is labelled, not guessed.** The reason comes straight from
 *   `outcome.arrear`; a course the arrear rule did not flag shows no such line.
 */
export function StudentGradesView({ completed }: StudentGradesViewProps) {
  if (completed.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No completed courses yet"
        description="A course appears here once it has ended, with its final verdict. Your marks for the current term are on the Marks page."
        action={
          <Link
            href="/student/marks"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Go to marks
          </Link>
        }
      />
    )
  }

  const summary = summariseOutcomes(completed)
  const hasNotJudged = summary.notJudged > 0

  return (
    <div className="space-y-6">
      <SectionCard
        title="Completed courses"
        description={`${summary.total} completed ${summary.total === 1 ? "course" : "courses"}.`}
        action={
          <InfoHint label="How the grand total and the verdict are decided">
            A total counts the published marks only, and a course with no published final-assessment
            mark has no total rather than a zero.
            {hasNotJudged
              ? " “Not judged” means the evidence is incomplete — it is not a failure."
              : ""}
          </InfoHint>
        }
      >
        <Table>
          <TableCaption className="sr-only">
            Completed courses with their outcome verdict, weighted grand total and term
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Course</TableHead>
              <TableHead scope="col">Term</TableHead>
              <TableHead scope="col">Result</TableHead>
              <TableHead scope="col">Grand total</TableHead>
              <TableHead scope="col">Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {completed.map((course) => (
              <TableRow key={course.offeringId} className="align-top">
                <TableHead scope="row" className="max-w-56 align-top font-normal">
                  <p className="font-medium">{course.courseName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{course.courseCode}</p>
                  <Link
                    href={{
                      pathname: "/student/course",
                      query: { courseCode: course.courseCode },
                    }}
                    className={`mt-1 inline-block ${LINK_CLASS}`}
                  >
                    View course
                  </Link>
                </TableHead>
                <TableCell className="align-top">
                  {course.term} {course.academicYear}
                </TableCell>
                <TableCell className="align-top">
                  <StatusPill
                    status={OUTCOME_STATUS_KEY[course.outcome.status]}
                    label={OUTCOME_LABEL[course.outcome.status]}
                    dot
                  />
                </TableCell>
                <TableCell className="align-top font-mono tabular-nums">
                  {formatPercent(course.grandTotal, 1)}
                </TableCell>
                <TableCell className="align-top whitespace-normal text-muted-foreground">
                  <p>{outcomeExplanation(course.outcome)}</p>
                  {course.arrear !== null && (
                    <p className="mt-1">
                      <span className="font-medium text-foreground">
                        {ARREAR_REASON_LABEL[course.arrear]}.
                      </span>{" "}
                      <Link href="/student/arrears" className={LINK_CLASS}>
                        See arrears
                      </Link>
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  )
}
