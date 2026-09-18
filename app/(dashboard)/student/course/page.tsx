import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ClipboardList, ExternalLink, GraduationCap, Library } from "lucide-react"

import { BackLink } from "@/components/back-link"
import { GradeBadge } from "@/components/grade-badge"
import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { InfoHint } from "@/components/ui/info-hint"
import { SectionCard } from "@/components/ui/section-card"
import { submissionLockReason } from "@/lib/assessment-submission-rules"
import { getSessionUser } from "@/lib/auth"
import { formatPercent, formatPoints, formatShortDate } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL, MATERIAL_KIND_LABEL } from "@/lib/labels"
import { listMaterialsForStudent } from "@/lib/materials"
import type { AuthUser } from "@/lib/session"
import { listStudentAssessments, type StudentAssessmentItem } from "@/lib/student-assessments"
import { SUBMISSION_STATE_LABEL } from "@/lib/student-dashboard-view"
import {
  buildStudentGrades,
  periodKey,
  periodLabel,
  type StudentSubjectGrades,
  type SubjectTermGroup,
} from "@/lib/student-grades"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Course" }

/** The route this page owns, for its own back affordance (the parent is a query, not a path). */
const HREF = "/student/course"

/**
 * One subject's hub.
 *
 * Route shape: `/student/course?courseCode=DEMO-MATH-101` — a **query param, not
 * a `[courseCode]` segment**, matching this app's deliberate no-id-segment-pages
 * rule (the same reason `/student/write` names its assessment with
 * `?assessmentId=`). So there is no `[courseCode]` directory, and the code is
 * read from `searchParams`.
 *
 * It combines three things that already have readers, for one subject:
 *
 * - **assessments** — `listStudentAssessments`, filtered to this course code;
 * - **marks** — the same rows, grouped by term with `buildStudentGrades`, so the
 *   subject row here and the subject row on `/student/grades` are one
 *   computation rather than two;
 * - **resources** — `listMaterialsForStudent`, filtered to this course code. That
 *   reader already implements the two-tier rule (material attached to an offering
 *   the student is in, **or** course-wide material for a course they are in), so
 *   this page adds no new query model — `Material.courseId` is required, which is
 *   exactly the key this page is addressed by.
 *
 * Everything comes from a reader that is already scoped to the signed-in student,
 * so matching on the query param can only ever select from rows they may see.
 * Nothing here is a new authorization surface.
 *
 * A code the student has neither assessments nor materials for renders an honest
 * empty state rather than an empty-looking hub, because "no such course" and "a
 * course with nothing in it yet" are different facts.
 */
export default async function StudentCoursePage({
  searchParams,
}: {
  searchParams: Promise<{ courseCode?: string | string[] }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const params = await searchParams
  const rawCode = Array.isArray(params.courseCode) ? params.courseCode[0] : params.courseCode
  const courseCode = (rawCode ?? "").trim()

  const payload = await listStudentAssessments(user)
  if (payload === null) redirect("/login")
  const materials = await listMaterialsForStudent(user)

  if (courseCode === "") {
    return renderScaffold(
      user,
      <EmptyState
        icon={GraduationCap}
        title="No course selected"
        description="Open this page from a subject on your grades page or a course on the assessments page."
        action={
          <Link
            href="/student/grades"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Go to grades
          </Link>
        }
      />,
    )
  }

  // Case-insensitive so a hand-typed or lower-cased link resolves to the same
  // course rather than an empty hub. Course codes are stored upper-case.
  const matches = (value: string) => value.toUpperCase() === courseCode.toUpperCase()

  const assessments = payload.assessments
    .filter((assessment) => matches(assessment.courseCode))
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime())
  const courseMaterials = materials.filter((material) => matches(material.courseCode))

  if (assessments.length === 0 && courseMaterials.length === 0) {
    return renderScaffold(
      user,
      <EmptyState
        icon={GraduationCap}
        title={`No course ${courseCode} on your record`}
        description="Either the code is wrong or you are not enrolled in that course. Only your own enrolments appear here."
        action={
          <Link
            href="/student/grades"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to grades
          </Link>
        }
      />,
    )
  }

  const grades = buildStudentGrades(payload.assessments)
  const subject: StudentSubjectGrades | null =
    grades.subjects.find((entry) => matches(entry.courseCode)) ?? null

  const courseName = subject?.courseName ?? assessments[0]?.courseName ?? courseCode.toUpperCase()
  const groups = subject === null ? [] : subjectGroups(subject)
  const currentKey = grades.currentPeriod === null ? null : periodKey(grades.currentPeriod)
  const percentages = groups
    .flatMap((group) => group.marks)
    .map((mark) => mark.percentage)
    .filter((value): value is number => value !== null)
  const average =
    percentages.length > 0
      ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
      : null

  return renderScaffold(
    user,
    <div className="space-y-6">
      <PageHeader
        eyebrow={courseCode.toUpperCase()}
        title={courseName}
        description="Assessments, released marks, and this course's resources in one place."
      />

      <SectionCard
        title="Course at a glance"
        action={
          <InfoHint label="How this course average is calculated">
            An average counts released marks only; an unreleased mark never moves it, and is never
            counted as zero.
          </InfoHint>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Current term</dt>
            {/*
              The *course's* current term, not the student's global one: on a
              course they no longer take, the student's newest term would be a
              fact about a different course.
            */}
            <dd className="mt-1 font-medium">
              {subject?.current ? periodLabel(subject.current.period) : "Not this term"}
            </dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Assessments</dt>
            <dd className="mt-1 font-medium">{assessments.length}</dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Released marks</dt>
            <dd className="mt-1 font-medium">{subject?.releasedMarkCount ?? 0}</dd>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Average (all terms)</dt>
            <dd className="mt-1 font-medium">{formatPercent(average, 1)}</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard
        title="Marks"
        description="Grouped by term, newest first. These are the same groups the grades page shows for this subject."
      >
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments for this course.</p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={periodLabel(group.period)} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold tracking-tight">
                    {periodLabel(group.period)}
                  </h3>
                  {periodKey(group.period) === currentKey && (
                    <Badge variant="secondary">Current term</Badge>
                  )}
                  <Badge variant="outline" className="font-mono tabular-nums">
                    {formatPercent(group.average, 1)}
                  </Badge>
                </div>
                {group.marks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {group.totalCount === 0
                      ? "No assessments in this term."
                      : `No marks released yet — ${describeUnreleased(group)}.`}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {group.marks.map((mark) => (
                      <li key={mark.assessmentId} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium">{mark.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {ASSESSMENT_KIND_LABEL[mark.type]} · due {formatShortDate(mark.dueDate)}
                        </span>
                        <span className="font-mono text-xs tabular-nums">
                          {formatPoints(mark.score, mark.maxMarks)} (
                          {formatPercent(mark.percentage, 1)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Assessments"
        description="Newest due date first. A mark appears only once it has been released."
      >
        {assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assessments released for this course yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {assessments.map((assessment) => (
              <li
                key={assessment.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{assessment.title}</span>
                    <Badge variant="outline">{ASSESSMENT_KIND_LABEL[assessment.type]}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {assessment.term} {assessment.academicYear} · {assessment.className} · due{" "}
                    {formatShortDate(assessment.dueDate)} · {assessmentStateLabel(assessment)}
                  </p>
                  {assessment.feedback && (
                    <p className="text-xs text-muted-foreground">{assessment.feedback}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {assessmentLinks(assessment)}
                  <GradeBadge pct={assessment.percentage} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Resources"
        description="Material attached to this course's offering, plus material shared across the course."
      >
        {courseMaterials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No resources for this course yet.</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {courseMaterials.map((material) => (
              <li
                key={material.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{material.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {MATERIAL_KIND_LABEL[material.kind]}
                    {material.indexed ? null : " · Not searchable yet"}
                  </p>
                </div>
                {material.sourceUrl && (
                  <a
                    href={material.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
                  >
                    Open
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Where else this course appears">
        <div className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/student/grades"
            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <GraduationCap className="size-3.5" aria-hidden="true" />
              Grades
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Completed courses, with the final verdict and weighted total.
            </span>
          </Link>
          <Link
            href={{ pathname: "/student/assessments", query: { type: "all" } }}
            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ClipboardList className="size-3.5" aria-hidden="true" />
              All assessments
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Every assessment across your courses, with filters.
            </span>
          </Link>
          <Link
            href="/student/resources"
            className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Library className="size-3.5" aria-hidden="true" />
              Resources
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Course material and revision collections.
            </span>
          </Link>
        </div>
      </SectionCard>
    </div>,
  )
}

/** Every term group a subject has, newest first. */
function subjectGroups(subject: StudentSubjectGrades): SubjectTermGroup[] {
  return subject.current === null ? subject.prior : [subject.current, ...subject.prior]
}

function describeUnreleased(group: SubjectTermGroup): string {
  const parts: string[] = []
  if (group.awaitingReleaseCount > 0) {
    parts.push(`${group.awaitingReleaseCount} marked and awaiting release`)
  }
  if (group.notMarkedCount > 0) parts.push(`${group.notMarkedCount} not marked yet`)
  return parts.join(", ")
}

/**
 * The submission state in a student's words.
 *
 * `hasMark && !published` gets its own sentence rather than "Not submitted",
 * because a mark exists and saying the work was never handed in would be false.
 */
function assessmentStateLabel(assessment: StudentAssessmentItem): string {
  // A released mark *is* grading done, whether or not a `Submission` row records
  // it — a manual mark can be entered with no submission row at all (the courses
  // seed does exactly that). Testing `hasMark` first reported "Marked — awaiting
  // release" beside the released percentage the same row renders, which is the
  // contradiction this order removes.
  if (assessment.submissionState === "graded" || assessment.published) return "Graded"
  // A state other than `not_submitted` is a real fact about the work, so it outranks a
  // mark that merely exists; this is the original precedence, kept. The wording comes
  // from the shared map, so `late` reads "Late" here as it does on the assessments hub,
  // the dashboard and the write editor, rather than the "Handed in late" this file had.
  if (assessment.submissionState !== "not_submitted") {
    return SUBMISSION_STATE_LABEL[assessment.submissionState]
  }
  // Only now is a mark the strongest signal: it exists, but the work was never handed in.
  if (assessment.hasMark) return "Marked — awaiting release"
  return SUBMISSION_STATE_LABEL.not_submitted
}

/** The per-kind way into an assessment, matching the assessments hub's affordances. */
function assessmentLinks(assessment: StudentAssessmentItem) {
  if (assessment.type === "QUIZ") {
    return (
      <Link
        href="/student/quizzes"
        className="rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
      >
        Open quiz
      </Link>
    )
  }
  if (assessment.type === "CODE") {
    return (
      <Link
        href={{ pathname: "/student/code-submissions", query: { assessmentId: assessment.id } }}
        className="rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
      >
        Open code editor
      </Link>
    )
  }
  if (assessment.type === "ASSIGNMENT" || assessment.type === "DESCRIPTIVE") {
    /*
     * The FAT gate, said here rather than only in the route's 403 (SN-24).
     *
     * The assessments hub withholds the editor while an assessment is blocked; this
     * hub offered an enabled link for the same record, so a student was invited to
     * write work the submission route then refused. Same rule, same surface shape.
     */
    if (assessment.submissionBlockedReason) {
      return (
        <span className="flex max-w-64 flex-col gap-1">
          <Button size="sm" variant="outline" disabled>
            Open writing editor
          </Button>
          <span className="text-xs text-destructive">{assessment.submissionBlockedReason}</span>
        </span>
      )
    }
    return (
      <span className="flex max-w-64 flex-col gap-1">
        <Link
          href={{ pathname: "/student/write", query: { assessmentId: assessment.id } }}
          className="rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
        >
          Open writing editor
        </Link>
        {/* Why draft-save is unavailable, in the same words the hub and the editor use. */}
        {submissionLockReason(assessment.submissionState) && (
          <span className="text-xs text-muted-foreground">
            {submissionLockReason(assessment.submissionState)}
          </span>
        )}
      </span>
    )
  }
  return null
}

/**
 * The shell every branch shares.
 *
 * The `BackLink` uses its `fallback` because this hub is reached from two places
 * (`/student/grades` and the assessments page) and a declarative parent would
 * have to pick one of them for the other's visitors. The map in
 * `lib/navigation.ts` is deliberately not extended for a page whose parent is
 * genuinely ambiguous; the fallback names the richer of the two.
 */
function renderScaffold(user: AuthUser, content: React.ReactNode) {
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
        <div className="mb-4">
          <BackLink pathname={HREF} fallback={{ label: "Grades", href: "/student/grades" }} />
        </div>
        {content}
      </AppShell>
    </RoleGuard>
  )
}
