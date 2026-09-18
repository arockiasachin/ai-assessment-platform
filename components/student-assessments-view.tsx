"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenCheck,
  CircleCheck,
  Clock,
  Layers,
  ListFilter,
  PenLine,
  Target,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react"
import { GradeBadge } from "@/components/grade-badge"
import { Badge } from "@/components/ui/badge"
import { StatusPill } from "@/components/ui/status-pill"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FilterBar } from "@/components/ui/filter-bar"
import { InfoHint } from "@/components/ui/info-hint"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"
import { regimeForCourse, type StudentCourseRegime } from "@/lib/grading/regime-view"
import { submissionLockReason, supportsTextSubmission } from "@/lib/assessment-submission-rules"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import type { StudentAssessmentItem, StudentAssessmentsPayload } from "@/lib/student-assessments"
import {
  activeAssessmentFilters,
  ASSESSMENT_COURSE_FILTER_ALL,
  ASSESSMENT_STATUS_FILTER_LABEL,
  ASSESSMENT_TYPE_FILTER_LABEL,
  assessmentStatusFilterOptions,
  assessmentTypeFilterOptions,
  assessmentsEmptyDescription,
  dueLabel,
  matchesCourseFilter,
  matchesStatusFilter,
  matchesTypeFilter,
  parseAssessmentTypeFilter,
  type AssessmentStatusFilter,
  type AssessmentTypeFilter,
} from "@/lib/student-assessments-view"
import {
  dueThisWeek,
  SUBMISSION_STATE_LABEL,
  SUBMISSION_STATE_TO_STATUS,
} from "@/lib/student-dashboard-view"

function round(value: number, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function dueTone(assessment: StudentAssessmentItem): "destructive" | "secondary" | "outline" {
  if (assessment.isPastDue) return "destructive"
  if (assessment.daysUntilDue <= 3) return "secondary"
  return "outline"
}

// `submissionLabel` and `submissionTone` were local copies of shared rules and had both
// drifted: `late` read "Late submission" here against "Late" in `lib/labels.ts` (the
// vocabulary of record) and on the dashboard, and the tone was a third colour system for
// the same state. Both now come from the shared maps, so the hub, the dashboard, the
// course hub and the write editor cannot disagree.

/**
 * The compact icon toggles' order and icons.
 *
 * Deliberately separate from their labels: the names come from the shared filter
 * maps in `lib/student-assessments-view.ts`, so a toggle and the Select option it
 * replaces render the same word for the same filter.
 */
const TYPE_TOGGLES = [
  { value: "all", icon: Layers },
  { value: "QUIZ", icon: BookOpenCheck },
  { value: "WRITTEN", icon: PenLine },
  { value: "CODE", icon: Terminal },
  { value: "GROUP_PROJECT", icon: Users },
] as const satisfies readonly { value: AssessmentTypeFilter; icon: LucideIcon }[]

const STATUS_TOGGLES = [
  { value: "all", icon: ListFilter },
  { value: "graded", icon: CircleCheck },
  { value: "pending", icon: Clock },
  { value: "overdue", icon: AlertTriangle },
] as const satisfies readonly { value: AssessmentStatusFilter; icon: LucideIcon }[]

/** One chip in the course scope, highlighting the selected course. */
function scopeChipClass(active: boolean) {
  return cn(
    "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
    active
      ? "border-primary/50 bg-primary/10 text-primary"
      : "border-border/70 bg-background/70 text-foreground hover:bg-muted",
  )
}

/**
 * A labelled group of icon toggle buttons.
 *
 * `aria-pressed` carries the selection and `aria-label`/`title` carry the name, so
 * an icon-only control still has an accessible name and a hover hint. The visible
 * "what is applied" line under the bar tells a sighted student the same thing
 * without hovering.
 */
function IconToggleGroup<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; icon: LucideIcon }[]
  labels: Record<T, string>
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            size="icon-sm"
            variant={active ? "secondary" : "outline"}
            aria-pressed={active}
            aria-label={labels[option.value]}
            title={labels[option.value]}
            onClick={() => onChange(option.value)}
          >
            <Icon />
          </Button>
        )
      })}
    </div>
  )
}

/**
 * What a student can do with one assessment.
 *
 * `compact` is the hub's "a course is selected" mode: the actions collapse to
 * icon-only buttons so the scoped list stays dense, and each keeps an accessible
 * name from `aria-label` plus a `title` tooltip. The blocked and lock reasons stay
 * visible in both modes — collapsing the button must not hide *why* it is dead.
 */
function AssessmentActions({
  assessment,
  compact,
}: {
  assessment: StudentAssessmentItem
  compact: boolean
}) {
  const lockReason = submissionLockReason(assessment.submissionState)

  if (assessment.type === "QUIZ") {
    return (
      <div className="flex flex-wrap gap-2">
        <Link href="/student/quizzes" className="inline-flex">
          <Button
            size={compact ? "icon-sm" : "sm"}
            variant="outline"
            aria-label="Open quiz"
            title="Open quiz"
          >
            <BookOpenCheck className="size-4" />
            {!compact && "Open quiz"}
          </Button>
        </Link>
      </div>
    )
  }

  if (assessment.type === "CODE") {
    return (
      <div className="flex flex-wrap gap-2">
        <Link
          href={{ pathname: "/student/code-submissions", query: { assessmentId: assessment.id } }}
          className="inline-flex"
        >
          <Button
            size={compact ? "icon-sm" : "sm"}
            variant="outline"
            aria-label="Open code editor"
            title="Open code editor"
          >
            <Terminal className="size-4" />
            {!compact && "Open code editor"}
          </Button>
        </Link>
      </div>
    )
  }

  if (assessment.type === "GROUP_PROJECT") {
    return (
      <p className="w-full rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        A group project has no individual text submission. Your team&apos;s work is handed in
        outside this card.
      </p>
    )
  }

  if (!supportsTextSubmission(assessment.type)) return null

  return (
    <div className="w-full space-y-2">
      {assessment.submissionBlockedReason ? (
        /*
         * The FAT gate, said before the student writes and presses Submit rather
         * than only in the route's 403 (SN-24). The editor is not offered while
         * blocked, matching the route.
         */
        <Button
          size={compact ? "icon-sm" : "sm"}
          variant="outline"
          disabled
          aria-label="Open writing editor"
          title="Open writing editor"
          className={compact ? undefined : "w-full sm:w-auto"}
        >
          <PenLine className="size-4" />
          {!compact && "Open writing editor"}
        </Button>
      ) : (
        <Link
          href={{ pathname: "/student/write", query: { assessmentId: assessment.id } }}
          className="inline-flex"
        >
          <Button
            size={compact ? "icon-sm" : "sm"}
            variant="outline"
            aria-label="Open writing editor"
            title="Open writing editor"
          >
            <PenLine className="size-4" />
            {!compact && "Open writing editor"}
          </Button>
        </Link>
      )}
      {lockReason && <p className="text-xs text-muted-foreground">{lockReason}</p>}
      {assessment.submissionBlockedReason && (
        <p className="text-xs text-destructive">{assessment.submissionBlockedReason}</p>
      )}
    </div>
  )
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
  const [statusFilter, setStatusFilter] = useState<AssessmentStatusFilter>("all")
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
   * (`/student/course?courseCode=…`), so the "Course hubs" chips and the hub link
   * they expose read the same list rather than two derivations of it. The chips
   * are the page's course selector: choosing one scopes the list to `courseId`.
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

  /*
   * The course scope — one course at a time, `All` by default.
   *
   * It is URL-driven (`?course=<code>`), exactly like `?type=`, for two reasons.
   * A scoped view is shareable and survives a reload; and in a project with no
   * browser automation, the scope is the only filter whose effect can be seen in
   * the server-rendered HTML at all. The chips in the hero *are* the course
   * hubs, so choosing one is also the page's course selector; the old Select of
   * courses inside the filter card is gone.
   *
   * The scope is stored by **id** (so one chip is one offering) but written to
   * the URL as the **code**, which is readable and is what the hub link uses.
   */
  const scopedCourse = useMemo(
    () => courseOptions.find((course) => course.code === searchParams.get("course")) ?? null,
    [courseOptions, searchParams],
  )
  const courseScope = scopedCourse?.id ?? ASSESSMENT_COURSE_FILTER_ALL
  /** A course is selected: the controls compact and the card actions become icons. */
  const compact = scopedCourse !== null
  const setCourseScope = (courseId: string) => {
    const params = new URLSearchParams(searchParams)
    const course = courseOptions.find((candidate) => candidate.id === courseId)
    if (course) params.set("course", course.code)
    else params.delete("course")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return allAssessments.filter((item) => {
      if (!matchesTypeFilter(item, typeFilter)) return false
      if (!matchesCourseFilter(item, courseScope)) return false

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
  }, [allAssessments, courseScope, search, statusFilter, typeFilter])

  /** What is narrowing the list, in words — the icon toggles have no visible text. */
  const appliedFilters = activeAssessmentFilters({
    courseLabel: scopedCourse?.code ?? null,
    typeFilter,
    statusFilter,
  })

  const clearFilters = () => {
    setCourseScope(ASSESSMENT_COURSE_FILTER_ALL)
    setStatusFilter("all")
    setTypeFilter("all")
  }

  const summary = useMemo(() => {
    const graded = allAssessments.filter((item) => item.percentage !== null)
    const avg =
      graded.length > 0
        ? graded.reduce((sum, item) => sum + (item.percentage ?? 0), 0) / graded.length
        : null

    return {
      total: allAssessments.length,
      graded: graded.length,
      average: avg,
      // Reuses the dashboard's `outstandingAssessments` rule through `dueThisWeek`,
      // so this tile and the dashboard's "Due this week" cannot disagree by
      // construction. The local count included work already handed in, which read
      // as due work still owed.
      dueNext7: dueThisWeek(allAssessments).length,
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
                {/*
                  The chips are the page's course selector: one course at a time,
                  All by default. They used to be plain links to each hub, which
                  left the filter card's course dropdown as the only way to scope
                  the list; the dropdown is gone and scoping now happens here.
                */}
                <div
                  role="group"
                  aria-label="Course scope"
                  className="mt-1 flex flex-wrap items-center gap-1.5"
                >
                  <button
                    type="button"
                    aria-pressed={courseScope === ASSESSMENT_COURSE_FILTER_ALL}
                    onClick={() => setCourseScope(ASSESSMENT_COURSE_FILTER_ALL)}
                    className={scopeChipClass(courseScope === ASSESSMENT_COURSE_FILTER_ALL)}
                  >
                    All
                  </button>
                  {courseOptions.map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      aria-pressed={courseScope === course.id}
                      onClick={() => setCourseScope(course.id)}
                      className={scopeChipClass(courseScope === course.id)}
                    >
                      {course.code}
                    </button>
                  ))}
                  {scopedCourse && (
                    // The selected course's hub, exposed as an icon while a course
                    // is scoped. Scoping is how the list narrows; this icon is how
                    // the student still reaches that course's own hub page.
                    <Link
                      href={{
                        pathname: "/student/course",
                        query: { courseCode: scopedCourse.code },
                      }}
                      aria-label={`Open the ${scopedCourse.code} course hub`}
                      title={`Open the ${scopedCourse.code} course hub`}
                      className={buttonVariants({ variant: "outline", size: "icon-xs" })}
                    >
                      <ArrowUpRight />
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Pick a course to scope every assessment to it; All restores the full list.
                </p>
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
              <p className="font-semibold text-foreground">{summary.dueNext7}</p>
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

      <section aria-labelledby="assessments-list-heading" className="space-y-3">
        <h2 id="assessments-list-heading" className="text-base font-semibold tracking-tight">
          Your assessments
        </h2>

        {/*
          The shared FilterBar replaced the hand-rolled card. It renders a visible
          Label per control and passes `items` to each Select root, which is what
          stops a trigger showing a raw stored value ("QUIZ", "graded"): the two
          defects the card had. It is fully controlled here — this component owns
          the filter state and the `?type=` URL contract.
        */}
        <FilterBar
          searchLabel="Search assessments"
          searchPlaceholder="Search by title, course, class, or teacher…"
          searchValue={search}
          onSearchChange={setSearch}
          selects={
            compact
              ? []
              : [
                  {
                    id: "assessment-type",
                    label: "Type",
                    value: typeFilter,
                    options: assessmentTypeFilterOptions(),
                    onValueChange: (value) => setTypeFilter(parseAssessmentTypeFilter(value)),
                  },
                  {
                    id: "assessment-status",
                    label: "Status",
                    value: statusFilter,
                    options: assessmentStatusFilterOptions(),
                    onValueChange: (value) => setStatusFilter(value as AssessmentStatusFilter),
                  },
                ]
          }
          resultCount={filtered.length}
          resultNoun="assessment"
        >
          {compact && (
            // A course is selected, so the type/status selects collapse to icon
            // toggles. Names come from the shared filter maps, so a toggle names
            // the same filter the select did.
            <>
              <IconToggleGroup
                label="Assessment type"
                value={typeFilter}
                options={TYPE_TOGGLES}
                labels={ASSESSMENT_TYPE_FILTER_LABEL}
                onChange={setTypeFilter}
              />
              <IconToggleGroup
                label="Submission status"
                value={statusFilter}
                options={STATUS_TOGGLES}
                labels={ASSESSMENT_STATUS_FILTER_LABEL}
                onChange={setStatusFilter}
              />
            </>
          )}
        </FilterBar>

        {appliedFilters.length > 0 && (
          // The icon toggles carry no visible text, so this is what tells a
          // student what is narrowing the list without opening a select.
          <p className="text-xs text-muted-foreground">
            Showing {appliedFilters.join(" · ")}.{" "}
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-sm font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
            >
              Clear filters
            </button>
          </p>
        )}

        {filtered.map((assessment) => {
          const isExpanded = Boolean(expanded[assessment.id])
          const tone = dueTone(assessment)

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
                    <StatusPill
                      status={SUBMISSION_STATE_TO_STATUS[assessment.submissionState]}
                      label={SUBMISSION_STATE_LABEL[assessment.submissionState]}
                      dot
                    />
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

                    {/* The per-card "View course" link is gone: the hero's
                        course chips already provide that entry, so repeating it
                        on every card was the duplication the owner called out
                        (Phase 6). The chips remain. When a course is scoped, the
                        per-assessment actions themselves collapse to icons. */}
                    <div className="mt-3">
                      <AssessmentActions assessment={assessment} compact={compact} />
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
