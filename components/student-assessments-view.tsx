"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { BookOpenCheck, Filter, PenLine, Search, Target, Terminal } from "lucide-react"
import { GradeBadge } from "@/components/grade-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { InfoHint } from "@/components/ui/info-hint"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDateTime } from "@/lib/format"
import { regimeForCourse, type StudentCourseRegime } from "@/lib/grading/regime-view"
import { submissionLockReason, supportsTextSubmission } from "@/lib/assessment-submission-rules"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import type { StudentAssessmentItem, StudentAssessmentsPayload } from "@/lib/student-assessments"
import {
  assessmentsEmptyDescription,
  dueLabel,
  matchesStatusFilter,
  matchesTypeFilter,
  parseAssessmentTypeFilter,
  type AssessmentTypeFilter,
} from "@/lib/student-assessments-view"

function round(value: number, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function dueTone(assessment: StudentAssessmentItem): "destructive" | "secondary" | "outline" {
  if (assessment.isPastDue) return "destructive"
  if (assessment.daysUntilDue <= 3) return "secondary"
  return "outline"
}

function submissionLabel(state: StudentAssessmentItem["submissionState"]) {
  if (state === "graded") return "Graded"
  if (state === "submitted") return "Submitted"
  if (state === "resubmitted") return "Resubmitted"
  if (state === "late") return "Late submission"
  if (state === "draft") return "Draft"
  return "Not submitted"
}

// The app themes via `prefers-color-scheme`, so the `.dark`-scoped Tailwind
// `dark:` variant never activates; the explicit media variant keeps the chip
// text readable on a dark page.
function submissionTone(state: StudentAssessmentItem["submissionState"]) {
  if (state === "graded")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  if (state === "submitted" || state === "resubmitted")
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
  if (state === "late")
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
  if (state === "draft")
    return "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
  return "border-border bg-muted/20 text-foreground"
}

export function StudentAssessmentsView({
  initialPayload,
  courseRegimes = [],
}: {
  initialPayload: StudentAssessmentsPayload
  /**
   * The grading regime of each of the student's courses, resolved on the server
   * (`lib/student-grading-regime.ts`). Optional so the component renders without it, but the
   * page always supplies it: a student who is graded on relative bands saw exactly the same
   * page as one graded on VIT's absolute table because this fact never reached them (SN-16).
   */
  courseRegimes?: StudentCourseRegime[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  /*
   * The type filter is **URL-driven** rather than local state, because the
   * sidebar's Assessments menu links to `/student/assessments?type=…`. Local
   * state would not update when a student clicks "Quizzes" while already on the
   * hub (the route does not remount), so the menu link would appear dead. The
   * other filters stay local: nothing outside this component sets them.
   */
  const typeFilter = parseAssessmentTypeFilter(searchParams.get("type"))
  const setTypeFilter = (value: AssessmentTypeFilter) => {
    const params = new URLSearchParams(searchParams)
    if (value === "all") params.delete("type")
    else params.set("type", value)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const [search, setSearch] = useState("")
  const [courseFilter, setCourseFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "graded" | "pending" | "overdue">("all")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  /*
   * Writing happens on the dedicated `/student/write` page now, so this view no
   * longer holds draft text or a save/submit state machine per card. The card
   * links to the editor with the assessment id, exactly as the code-task card
   * links to `/student/code-submissions`. The payload still carries
   * `submissionContent`; the editor page is what reads it.
   */
  const allAssessments = useMemo(() => initialPayload.assessments, [initialPayload])

  /**
   * The regime notes to render, one per course that appears in the list.
   *
   * The payload carries `courseId` but no `offeringId`, so the lookup is by course (see
   * `regimeForCourse`). Deduping here means the note is rendered once per course above the
   * cards rather than repeated on every assessment of that course.
   */
  const courseRegimeNotes = useMemo(() => {
    const seen = new Set<string>()
    const notes: StudentCourseRegime[] = []
    for (const assessment of allAssessments) {
      if (seen.has(assessment.courseId)) continue
      seen.add(assessment.courseId)
      const regime = regimeForCourse(courseRegimes, assessment.courseId)
      if (regime) notes.push(regime)
    }
    return notes
  }, [allAssessments, courseRegimes])

  /**
   * One entry per course, carrying the code as well as the id.
   *
   * The code is what the course hub is addressed by
   * (`/student/course?courseCode=…`), so the "Course hubs" links below and the
   * Select above read the same list rather than two derivations of it.
   */
  const courseOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; code: string }>()
    for (const item of allAssessments) {
      if (!byId.has(item.courseId)) {
        byId.set(item.courseId, {
          id: item.courseId,
          name: item.courseName,
          code: item.courseCode,
        })
      }
    }
    return [...byId.values()]
  }, [allAssessments])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return allAssessments.filter((item) => {
      if (!matchesTypeFilter(item, typeFilter)) return false
      if (courseFilter !== "all" && item.courseId !== courseFilter) return false

      // The status filter is one definition shared with the tests
      // (`lib/student-assessments-view.ts`). Keying Overdue on `isPastDue` alone
      // counted a late submission as still overdue (SN-25); the badge it must agree
      // with now lives beside it.
      if (!matchesStatusFilter(item, statusFilter)) return false

      if (!q) return true
      const text = [item.title, item.courseName, item.courseCode, item.className, item.teacherName]
        .join(" ")
        .toLowerCase()
      return text.includes(q)
    })
  }, [allAssessments, courseFilter, search, statusFilter, typeFilter])

  const summary = useMemo(() => {
    const graded = allAssessments.filter((item) => item.percentage !== null)
    const avg =
      graded.length > 0
        ? graded.reduce((sum, item) => sum + (item.percentage ?? 0), 0) / graded.length
        : null

    const upcoming = allAssessments.filter(
      (item) => item.daysUntilDue >= 0 && item.daysUntilDue <= 7,
    ).length

    return {
      total: allAssessments.length,
      graded: graded.length,
      average: avg,
      upcoming,
    }
  }, [allAssessments])

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {/*
              The hero is the course-hub entry point now. The "Assessment hub"
              badge and the "Track every assessment with full detail" headline
              that used to sit here were marketing copy for a page that already
              says what it does, so they were deleted outright (Phase 6).
            */}
            {courseOptions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Course hubs</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {courseOptions.map((course) => (
                    <li key={course.id}>
                      <Link
                        href={{
                          pathname: "/student/course",
                          query: { courseCode: course.code },
                        }}
                        className="inline-flex items-center rounded-md border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-xs text-primary transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
                      >
                        {course.code}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold text-foreground">{summary.total}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Graded</p>
              <p className="font-semibold text-foreground">{summary.graded}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Average</p>
              <p className="font-semibold text-foreground">
                {summary.average === null ? "—" : `${round(summary.average)}%`}
              </p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Due in 7d</p>
              <p className="font-semibold text-foreground">{summary.upcoming}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* How each course is graded, collapsed behind an info hint. It changes how
          every score below should be read, so it stays discoverable, but it is
          static guidance rather than the result of an action — the boxes used to
          take the space the marks need (Phase 6). */}
      {courseRegimeNotes.length > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Target className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span>How each of your courses is graded</span>
          <InfoHint label="How each of your courses is graded">
            <ul className="space-y-1.5">
              {courseRegimeNotes.map((regime) => (
                <li key={regime.offeringId}>
                  <span className="font-medium text-foreground">
                    {regime.courseCode} · {regime.courseName}
                  </span>{" "}
                  — {regime.note.title}: {regime.note.detail}
                </li>
              ))}
            </ul>
          </InfoHint>
        </p>
      )}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          {/* A real heading: the filter is a section of the page, so the
              outline reads h1 → h2 (filter, list). */}
          <h2 className="inline-flex items-center gap-2 text-base leading-snug font-medium tracking-tight">
            <Filter className="size-4 text-primary" aria-hidden="true" />
            Filter and explore
          </h2>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, course, class, or teacher"
              aria-label="Search assessments"
              className="pl-8"
            />
          </div>

          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(parseAssessmentTypeFilter(value))}
          >
            <SelectTrigger aria-label="Filter by assessment type">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {Object.entries(ASSESSMENT_KIND_LABEL)
                // The sidebar lists written work as one entry, so the control
                // offers the same grouping rather than two kinds it never links.
                .filter(([value]) => value !== "DESCRIPTIVE" && value !== "ASSIGNMENT")
                .map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              <SelectItem value="WRITTEN">Written and assignments</SelectItem>
            </SelectContent>
          </Select>

          <Select value={courseFilter} onValueChange={(value) => setCourseFilter(value ?? "all")}>
            <SelectTrigger aria-label="Filter by course">
              <SelectValue placeholder="Course" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courseOptions.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value as "all" | "graded" | "pending" | "overdue") ?? "all")
            }
          >
            <SelectTrigger aria-label="Filter by submission status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="graded">Graded</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <section aria-labelledby="assessments-list-heading" className="space-y-3">
        <h2 id="assessments-list-heading" className="text-base font-semibold tracking-tight">
          Your assessments
        </h2>
        {filtered.map((assessment) => {
          const isExpanded = Boolean(expanded[assessment.id])
          const tone = dueTone(assessment)
          const lockReason = submissionLockReason(assessment.submissionState)

          return (
            <Card key={assessment.id} className="overflow-hidden border-border/70 shadow-sm">
              <CardContent className="p-0">
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  className="flex w-full flex-col gap-3 px-4 py-4 text-left sm:flex-row sm:items-start sm:justify-between"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [assessment.id]: !prev[assessment.id] }))
                  }
                >
                  <div className="space-y-1">
                    {/* Larger than the metadata below it and the badges beside
                        it, so the row scans as title → context → state. */}
                    <p className="text-base font-semibold tracking-tight">{assessment.title}</p>
                    {/* Labelled metadata rows rather than two muted sentences:
                        every fact has a name, so the row can be skimmed by label
                        and no value is left dangling after a separator. */}
                    <dl className="mt-1 grid gap-x-5 gap-y-0.5 text-xs sm:grid-cols-2">
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">Course</dt>
                        <dd className="truncate font-medium">
                          {assessment.courseCode} · {assessment.courseName}
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">Class</dt>
                        <dd className="truncate font-medium">{assessment.className}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">Term</dt>
                        <dd className="font-medium">
                          {assessment.term} {assessment.academicYear}
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">Teacher</dt>
                        <dd className="truncate font-medium">{assessment.teacherName}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge variant={tone}>{dueLabel(assessment)}</Badge>
                    <Badge variant="outline">{ASSESSMENT_KIND_LABEL[assessment.type]}</Badge>
                    <Badge variant="outline" className={submissionTone(assessment.submissionState)}>
                      {submissionLabel(assessment.submissionState)}
                    </Badge>
                    <GradeBadge pct={assessment.percentage} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/70 bg-muted/10 px-4 py-4">
                    <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Due date</p>
                        <p className="mt-1 font-medium">{formatDateTime(assessment.dueDate)}</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Your score</p>
                        <p className="mt-1 font-medium">
                          {assessment.score !== null
                            ? `${assessment.score}/${assessment.maxMarks} (${round(assessment.percentage ?? 0)}%)`
                            : assessment.hasMark && !assessment.published
                              ? // A mark exists but has not been released. Saying
                                // "Not graded" here would be untrue, and showing
                                // the value would leak an unreleased mark.
                                "Marked — awaiting release"
                              : // No mark at all: `null` renders as an em dash,
                                // never 0.
                                "—"}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Class average</p>
                        <p className="mt-1 font-medium">
                          {assessment.classAverageWithheld
                            ? "Withheld"
                            : assessment.classAveragePercentage === null
                              ? "—"
                              : `${round(assessment.classAveragePercentage)}%`}
                        </p>
                        {assessment.classAverageWithheld && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Shown only once at least {assessment.classAverageMinimumCohort} released
                            marks exist, so a classmate&apos;s mark cannot be derived.{" "}
                            {assessment.classAverageCohortSize} so far.
                          </p>
                        )}
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Quiz questions</p>
                        <p className="mt-1 font-medium">
                          {assessment.type === "QUIZ" ? assessment.quizQuestionCount : "N/A"}
                        </p>
                      </div>
                    </div>

                    {assessment.feedback && (
                      <div className="mt-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">
                          Teacher feedback
                        </p>
                        <p className="mt-1">{assessment.feedback}</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {/* The per-card "View course" link is gone: the hero's
                          course chips already provide that entry, so repeating
                          it on every card was the duplication the owner called
                          out (Phase 6). The chips remain. */}
                      {assessment.type === "QUIZ" ? (
                        <Link href="/student/quizzes" className="inline-flex">
                          <Button size="sm" variant="outline">
                            <BookOpenCheck className="size-4" />
                            Open quiz
                          </Button>
                        </Link>
                      ) : assessment.type === "CODE" ? (
                        <Link
                          href={{
                            pathname: "/student/code-submissions",
                            query: { assessmentId: assessment.id },
                          }}
                          className="inline-flex"
                        >
                          <Button size="sm" variant="outline">
                            <Terminal className="size-4" />
                            Open code editor
                          </Button>
                        </Link>
                      ) : assessment.type === "GROUP_PROJECT" ? (
                        <p className="w-full rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                          A group project has no individual text submission. Your team&apos;s work
                          is handed in outside this card.
                        </p>
                      ) : supportsTextSubmission(assessment.type) ? (
                        <div className="w-full space-y-2">
                          {assessment.submissionBlockedReason ? (
                            /*
                             * The FAT gate, said before the student writes and presses
                             * Submit rather than only in the route's 403 (SN-24). The
                             * editor is not offered while blocked, matching the route.
                             */
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              className="w-full sm:w-auto"
                            >
                              <PenLine className="size-4" />
                              Open writing editor
                            </Button>
                          ) : (
                            <Link
                              href={{
                                pathname: "/student/write",
                                query: { assessmentId: assessment.id },
                              }}
                              className="inline-flex"
                            >
                              <Button size="sm" variant="outline">
                                <PenLine className="size-4" />
                                Open writing editor
                              </Button>
                            </Link>
                          )}
                          {lockReason && (
                            <p className="text-xs text-muted-foreground">{lockReason}</p>
                          )}
                          {assessment.submissionBlockedReason && (
                            <p className="text-xs text-destructive">
                              {assessment.submissionBlockedReason}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {assessmentsEmptyDescription(allAssessments.length)}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}
