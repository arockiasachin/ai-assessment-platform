import Link from "next/link"
import { ClipboardList } from "lucide-react"

import { StudentArrearsNotice } from "@/components/student-arrears-notice"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { InfoHint } from "@/components/ui/info-hint"
import { SectionCard } from "@/components/ui/section-card"
import { formatPercent, formatPoints, formatShortDate } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import {
  periodLabel,
  type CurrentTermMarks,
  type ReleasedMark,
  type SubjectTermGroup,
} from "@/lib/student-grades"
import type { ArrearEntry } from "@/lib/student-outcome-view"

export type StudentMarksViewProps = {
  marks: CurrentTermMarks
  /** Outstanding arrears, so the current-standing page surfaces them without a hunt. */
  arrears: ArrearEntry[]
}

const LINK_CLASS =
  "rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"

/**
 * Marks — the current term.
 *
 * The everyday "how am I doing now" page. It shows only the derived current period's
 * released marks, grouped by subject; completed courses and their outcome verdicts live
 * on `/student/grades`, and the outstanding list lives on `/student/arrears`.
 *
 * Rendering rules that are load-bearing here:
 *
 * - **A mark is a released mark.** Only `group.marks` is listed. `hasMark && !published`
 *   is "marked and awaiting release"; `!hasMark` is "not marked yet". The two are
 *   counted apart so the page can say which is true, and neither is drawn as a `0`.
 * - **A missing number is `—`.** `formatPercent(null)` is an em dash, so a subject with
 *   nothing released has no average rather than a zero average.
 * - **A mark with no computable percentage is still a mark.** It is listed, and it does
 *   not move the mean (see `lib/student-grades.ts`).
 */
export function StudentMarksView({ marks, arrears }: StudentMarksViewProps) {
  const unreleased = marks.awaitingReleaseCount + marks.notMarkedCount

  return (
    <div className="space-y-6">
      <StudentArrearsNotice arrears={arrears} />

      <SectionCard
        title="This term at a glance"
        action={
          <InfoHint label="How the term average is calculated">
            Every average is the mean of released marks only. An unreleased mark never moves it, and
            is never counted as zero.
          </InfoHint>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Current term</dt>
            <dd className="mt-1 font-medium">
              {marks.period === null ? "—" : periodLabel(marks.period)}
            </dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Subjects</dt>
            <dd className="mt-1 font-medium">{marks.subjects.length}</dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Released marks</dt>
            <dd className="mt-1 font-medium">{marks.releasedMarkCount}</dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Average</dt>
            <dd className="mt-1 font-medium">{formatPercent(marks.average, 1)}</dd>
          </div>
        </dl>
        {unreleased > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {marks.awaitingReleaseCount > 0
              ? `${marks.awaitingReleaseCount} ${
                  marks.awaitingReleaseCount === 1 ? "mark is" : "marks are"
                } entered and awaiting release`
              : null}
            {marks.awaitingReleaseCount > 0 && marks.notMarkedCount > 0 ? " · " : null}
            {marks.notMarkedCount > 0
              ? `${marks.notMarkedCount} ${
                  marks.notMarkedCount === 1 ? "assessment is" : "assessments are"
                } not marked yet`
              : null}
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Marks by subject"
        action={
          <InfoHint label="Which marks this page lists">
            Your current term only. Previous and completed courses are on the grades page.
          </InfoHint>
        }
      >
        {marks.subjects.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={
              marks.period === null
                ? "No marks to show yet"
                : `No released marks for ${periodLabel(marks.period)}`
            }
            description={
              marks.period === null
                ? "You have no assessed work on record yet. Once a teacher releases a mark, it appears here."
                : "Nothing has been released for this term so far. A mark appears here the moment it is released, never while it is still withheld."
            }
          />
        ) : (
          <div className="relative w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <caption className="sr-only">
                Released marks for the current term, grouped by subject
              </caption>
              <thead>
                <tr className="border-b">
                  <th
                    scope="col"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
                  >
                    Subject
                  </th>
                  <th
                    scope="col"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
                  >
                    Released marks
                  </th>
                  <th
                    scope="col"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
                  >
                    Average
                  </th>
                  <th
                    scope="col"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
                  >
                    Not released
                  </th>
                </tr>
              </thead>
              {marks.subjects.map((subject) => (
                <tbody key={subject.courseId} className="border-b last:border-b-0">
                  <tr className="align-top">
                    <th scope="row" className="max-w-56 p-2 text-left align-top font-normal">
                      <p className="font-medium">{subject.courseName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {subject.courseCode}
                      </p>
                      <Link
                        href={{
                          pathname: "/student/course",
                          query: { courseCode: subject.courseCode },
                        }}
                        className={`mt-1 inline-block ${LINK_CLASS}`}
                      >
                        View course
                      </Link>
                    </th>
                    <td className="p-2 align-top">
                      {subject.group.marks.length === 0 ? (
                        <UnreleasedNote group={subject.group} />
                      ) : (
                        <MarkList marks={subject.group.marks} />
                      )}
                    </td>
                    <td className="p-2 align-top">
                      <Badge variant="outline" className="font-mono tabular-nums">
                        {formatPercent(subject.group.average, 1)}
                      </Badge>
                    </td>
                    <td className="p-2 align-top text-muted-foreground">
                      {subject.group.unreleasedCount}
                    </td>
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

/** Released marks for one subject in the current term. */
function MarkList({ marks }: { marks: ReleasedMark[] }) {
  return (
    <ul className="space-y-1">
      {marks.map((mark) => (
        <li key={mark.assessmentId} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{mark.title}</span>
          <span className="text-xs text-muted-foreground">
            {ASSESSMENT_KIND_LABEL[mark.type]} · due {formatShortDate(mark.dueDate)}
          </span>
          <span className="font-mono text-xs tabular-nums">
            {formatPoints(mark.score, mark.maxMarks)} ({formatPercent(mark.percentage, 1)})
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Why a subject shows no marks: "marked, awaiting release" and "not marked yet" are
 * different facts, and the copy keeps them apart rather than saying "no marks" for both.
 */
function UnreleasedNote({ group }: { group: SubjectTermGroup }) {
  if (group.totalCount === 0) {
    return <p className="text-sm text-muted-foreground">No assessments in this term.</p>
  }
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-muted-foreground">No marks released yet</p>
      <p className="text-xs text-muted-foreground">
        {group.awaitingReleaseCount > 0
          ? `${group.awaitingReleaseCount} marked and awaiting release`
          : null}
        {group.awaitingReleaseCount > 0 && group.notMarkedCount > 0 ? " · " : null}
        {group.notMarkedCount > 0 ? `${group.notMarkedCount} not marked yet` : null}
      </p>
    </div>
  )
}
