import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { GraduationCap, Info, TrendingUp } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { getSessionUser } from "@/lib/auth"
import { formatPercent, formatPoints, formatShortDate } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import { listStudentAssessments } from "@/lib/student-assessments"
import {
  buildStudentGrades,
  periodLabel,
  type ReleasedMark,
  type StudentSubjectGrades,
  type SubjectTermGroup,
} from "@/lib/student-grades"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Grades" }

const HREF = "/student/grades"

/**
 * Grades.
 *
 * The page the student rail gained in Phase 2. It is deliberately **not** a
 * second assessments list: the hub already lists every assessment with its
 * status, and repeating that here would give the same rows two homes. What this
 * page adds is the roll-up the hub does not do — released marks grouped by
 * subject and by term, with the student's current term split from the terms they
 * have finished.
 *
 * ## Honesty rules this page is built on
 *
 * - **A mark is a released mark.** `Grade.publishedAt != null` is the predicate
 *   (see `lib/student-grades.ts`); an unreleased mark never appears, and neither
 *   does a `0` standing in for one.
 * - **`null` is `—`, never `0`.** `formatPercent`/`formatPoints` already do this.
 *   A subject whose current term has nothing released shows a sentence, not a
 *   zero average.
 * - **The two empty states are different sentences.** "No marks released yet"
 *   means the student has work this term that is not out yet; "No previous
 *   semesters" means there is no earlier term at all. Collapsing them into one
 *   message would hide which is true — and the seed deliberately produces both,
 *   for `demo.student1` and `demo.student4` respectively.
 * - **The current term is derived, and the page says so.** There is no semester
 *   model to read, so `buildStudentGrades` orders the student's own periods and
 *   treats the newest as current; the note in the table's description states that
 *   rather than implying a stored term record.
 *
 * Server component: the reader is `listStudentAssessments`, the same one the
 * assessments hub uses, so the two cannot disagree about which marks exist. The
 * prior-terms disclosure is a native `<details>`, which is why this page needs no
 * client island to be collapsible.
 */
export default async function StudentGradesPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const payload = await listStudentAssessments(user)
  if (payload === null) redirect("/login")

  const grades = buildStudentGrades(payload.assessments)

  const releasedMarks = grades.subjects.reduce(
    (total, subject) => total + subject.releasedMarkCount,
    0,
  )
  const percentages = grades.subjects
    .flatMap((subject) => subjectGroups(subject).flatMap((group) => group.marks))
    .map((mark) => mark.percentage)
    .filter((value): value is number => value !== null)
  const overallAverage =
    percentages.length > 0
      ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      : null

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader title="Grades" description={findNavItemByAppPath(HREF)?.item.description} />

        {grades.subjects.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No marks to show yet"
            description="Grades appear here once a teacher releases a mark. Until then your assessments are listed on the assessments page."
          />
        ) : (
          <div className="space-y-6">
            <SectionCard
              title="Your marks at a glance"
              description="Every average below is the mean of released marks only. A mark that has not been released is never counted, and never counted as zero."
            >
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Current term</dt>
                  <dd className="mt-1 font-medium">
                    {grades.currentPeriod === null ? "—" : periodLabel(grades.currentPeriod)}
                  </dd>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Subjects</dt>
                  <dd className="mt-1 font-medium">{grades.subjects.length}</dd>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Released marks</dt>
                  <dd className="mt-1 font-medium">{releasedMarks}</dd>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <dt className="text-xs text-muted-foreground">Overall average</dt>
                  <dd className="mt-1 font-medium">{formatPercent(overallAverage, 1)}</dd>
                </div>
              </dl>

              {grades.periods.length <= 1 && (
                <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    No previous semesters on record — this is the first term you have assessments
                    in.
                  </span>
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Marks by subject"
              description="Your current term is the most recent term you have work in; earlier terms are collapsed beneath each subject. There is no separate semester record — the term and academic year are the whole period."
            >
              <div className="relative w-full overflow-x-auto">
                <table className="w-full caption-bottom text-sm">
                  <caption className="sr-only">
                    Released marks grouped by subject, with the current term and previous semesters
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
                        Current term
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
                      <th
                        scope="col"
                        className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap"
                      >
                        Previous semesters
                      </th>
                    </tr>
                  </thead>
                  {grades.subjects.map((subject) => (
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
                            className="mt-1 inline-block rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
                          >
                            View course
                          </Link>
                        </th>
                        <td className="p-2 align-top">
                          {subject.current === null ? (
                            <p className="text-muted-foreground">
                              Not in{" "}
                              {grades.currentPeriod === null
                                ? "the current term"
                                : periodLabel(grades.currentPeriod)}
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium text-muted-foreground">
                                {periodLabel(subject.current.period)}
                              </p>
                              {subject.current.marks.length === 0 ? (
                                <UnreleasedNote group={subject.current} />
                              ) : (
                                <MarkList marks={subject.current.marks} />
                              )}
                            </div>
                          )}
                        </td>
                        <td className="p-2 align-top">
                          <Badge variant="outline" className="font-mono tabular-nums">
                            {formatPercent(subject.current?.average ?? null, 1)}
                          </Badge>
                        </td>
                        <td className="p-2 align-top text-muted-foreground">
                          {/*
                            `—` and not `0` when there is no current-term group at all:
                            the count is "assessments in the current term with no released
                            mark", and a subject the student is not taking has no such
                            assessments — which is not the same fact as "none pending".
                          */}
                          {subject.current === null ? "—" : subject.current.unreleasedCount}
                        </td>
                        <td className="p-2 align-top">
                          {subject.prior.length === 0 ? (
                            <p className="text-muted-foreground">No previous semesters</p>
                          ) : (
                            <details className="group">
                              <summary className="cursor-pointer rounded-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring">
                                {subject.prior.length}{" "}
                                {subject.prior.length === 1
                                  ? "previous semester"
                                  : "previous semesters"}
                              </summary>
                              <div className="mt-3 space-y-4">
                                {subject.prior.map((group) => (
                                  <div key={periodLabel(group.period)} className="space-y-1.5">
                                    <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                                      <span>{periodLabel(group.period)}</span>
                                      <Badge variant="outline" className="font-mono tabular-nums">
                                        {formatPercent(group.average, 1)}
                                      </Badge>
                                    </p>
                                    {group.marks.length === 0 ? (
                                      <UnreleasedNote group={group} />
                                    ) : (
                                      <MarkList marks={group.marks} />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  ))}
                </table>
              </div>
            </SectionCard>

            <SectionCard title="How to read this page">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <TrendingUp className="size-3.5" aria-hidden="true" />
                    Averages count released marks only
                  </p>
                  <p className="mt-1 text-sm">
                    An unreleased mark is withheld from you and from every average here, so the
                    number cannot move on a mark you have not been shown.
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Info className="size-3.5" aria-hidden="true" />
                    Current and previous terms
                  </p>
                  <p className="mt-1 text-sm">
                    The current term is the most recent term you have work in. Everything else is a
                    previous semester, listed under its subject.
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}

/** Every term group a subject has, current first, then prior newest-first. */
function subjectGroups(subject: StudentSubjectGrades): SubjectTermGroup[] {
  return subject.current === null ? subject.prior : [subject.current, ...subject.prior]
}

/** Released marks for one subject in one term. */
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
 * Why a term shows no marks.
 *
 * Two genuinely different facts, and the copy distinguishes them rather than
 * saying "no marks" for both: a mark that exists but has not been released is
 * something the student is waiting on, and one that has not been entered yet is
 * not.
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
