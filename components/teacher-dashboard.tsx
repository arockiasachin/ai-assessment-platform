"use client"

import Link from "next/link"
import { ClipboardCheck, TrendingUp, TriangleAlert, Users, type LucideIcon } from "lucide-react"

import { TrendChart } from "@/components/charts"
import { StatCard } from "@/components/stat-card"
import { buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CalendarEventItem } from "@/lib/calendar"
import type { TeacherAnalyticsOverviewResponse } from "@/lib/contracts/analytics"
import { formatConfidence, formatDate, formatDateTime, formatPercent } from "@/lib/format"
import {
  ASSESSMENT_KIND_LABEL,
  CALENDAR_KIND_LABEL,
  CALENDAR_KIND_TONE,
  REVIEW_STATE_LABEL,
  REVIEW_STATE_TO_STATUS,
} from "@/lib/labels"
import type { ReviewQueueItem } from "@/lib/rubric-grading/contracts"
import type { TeacherDeadlineItem } from "@/lib/teacher-planner"
import {
  attentionForOffering,
  buildAssessmentProgressRows,
  cohortTrendPoints,
  hasTrendData,
  lowestConfidence,
  teacherDashboardKpis,
  type AssessmentProgressRow,
  type TeacherKpiId,
} from "@/lib/teacher-dashboard-view"

/**
 * The teacher dashboard, ported onto the mockup's composition.
 *
 * Five sections from `app/mockup/teacher/page.tsx`: four KPI tiles, the review
 * backlog, the cohort trend, the upcoming calendar, and per-assessment marking
 * progress. Everything is server props — the gradebook context is no longer read
 * here. The editable marks grid that used to live on this page moved to
 * `/teacher/marks`, because this composition has no place to put it.
 *
 * ## Deliberate departures from the mockup
 *
 * - **No KPI sparklines and no `delta`.** Both need stored history that does not
 *   exist; drawing them would be fabrication. See `lib/teacher-dashboard-view.ts`.
 * - **No term target on the trend.** `CohortTrend` carries no target, so the chart is
 *   the weekly series alone and the section states the released-mark count instead.
 * - **No `weightPercent` column** in the progress table — no backing column.
 * - **No assessment-kind sub-line** in the review table — `ReviewQueueItem` has no
 *   assessment type.
 * - **"Why it is here"** renders the reader's real `flags`. The mockup's fallback
 *   "Below the confidence floor" is *not* used: the reader already supplies a
 *   fallback flag for a `NEEDS_REVIEW` row with no recorded reasons, and printing a
 *   confidence-floor claim for a `PENDING` row with no flags would invent a reason.
 */

type Overview = Omit<TeacherAnalyticsOverviewResponse, "success">

const KPI_ICONS: Record<TeacherKpiId, LucideIcon> = {
  enrolled: Users,
  "cohort-average": TrendingUp,
  "awaiting-review": ClipboardCheck,
  "at-risk": TriangleAlert,
}

export function TeacherDashboard({
  overview,
  reviewQueue,
  deadlines,
  upcoming,
}: {
  overview: Overview
  reviewQueue: ReviewQueueItem[]
  deadlines: TeacherDeadlineItem[]
  /** The next entries after the server's clock — computed by the page, not here. */
  upcoming: CalendarEventItem[]
}) {
  const offering = overview.offerings.find((entry) => entry.id === overview.offeringId) ?? null
  const offeringLabel = offering
    ? [offering.courseCode, offering.className, offering.term].filter(Boolean).join(" · ")
    : "No offering"

  const assessmentIds = overview.assessments.map((assessment) => assessment.id)
  const attention = attentionForOffering(reviewQueue, assessmentIds)
  const progressRows = buildAssessmentProgressRows(overview.assessments, deadlines)
  const kpis = teacherDashboardKpis({
    offeringLabel,
    enrolledCount: overview.gradingRegime.enrolledCount,
    assessments: overview.assessments,
    awaitingReview: attention.total,
    atRisk: overview.atRisk.atRisk,
  })

  const reviewColumns: Column<ReviewQueueItem>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => <TruncatedText className="font-medium">{row.student.fullName}</TruncatedText>,
    },
    {
      id: "assessment",
      header: "Assessment",
      hideBelow: "md",
      cell: (row) => <span className="text-muted-foreground">{row.assessment.title}</span>,
    },
    {
      id: "why",
      header: "Why it is here",
      hideBelow: "lg",
      cell: (row) =>
        row.flags.length === 0 ? (
          <span className="text-muted-foreground">No flags recorded</span>
        ) : (
          <span className="text-xs text-muted-foreground">{row.flags.join(" · ")}</span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={REVIEW_STATE_TO_STATUS[row.review.status]}
          label={REVIEW_STATE_LABEL[row.review.status]}
          dot
        />
      ),
    },
    {
      id: "confidence",
      header: "Confidence",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatConfidence(lowestConfidence(row.suggestions))}
        </span>
      ),
    },
  ]

  const progressColumns: Column<AssessmentProgressRow>[] = [
    {
      id: "title",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium">{row.title}</TruncatedText>
          {row.kind && (
            <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
          )}
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      hideBelow: "sm",
      cell: (row) => <span className="text-muted-foreground">{formatDate(row.dueDate)}</span>,
    },
    {
      id: "marked",
      header: "Marked",
      cell: (row) =>
        row.graded === null || row.submitted === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ProgressBar
            className="w-36"
            label="Marked"
            value={row.graded}
            max={row.submitted}
            valueText={`${row.graded} / ${row.submitted}`}
            tone={row.submitted > 0 && row.graded === row.submitted ? "success" : "primary"}
          />
        ),
    },
    {
      id: "submitted",
      header: "Submitted",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.submitted === null
            ? "—"
            : `${row.submitted} / ${overview.gradingRegime.enrolledCount}`}
        </span>
      ),
    },
    {
      id: "mean",
      header: "Mean",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatPercent(row.averagePercent)}</span>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) =>
        row.released === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusPill
            status={row.released ? "published" : "draft"}
            label={row.released ? "Released" : "Not released"}
            dot
          />
        ),
    },
  ]

  const upcomingItems: TimelineItem[] = upcoming.map((event) => ({
    id: event.id,
    title: (
      <span className="flex flex-wrap items-center gap-2">
        {event.title}
        <StatusPill
          status={CALENDAR_KIND_TONE[event.kind]}
          label={CALENDAR_KIND_LABEL[event.kind]}
        />
      </span>
    ),
    description: event.detail,
    meta: `${formatDateTime(event.startAt)}${event.location ? ` · ${event.location}` : ""}`,
    tone: CALENDAR_KIND_TONE[event.kind],
  }))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.hint}
            icon={KPI_ICONS[kpi.id]}
            accent={kpi.accent}
          />
        ))}
      </div>

      <SectionCard
        title="Needs your attention"
        description={`${attention.total} AI suggestion${attention.total === 1 ? " is" : "s are"} waiting on a human decision in this offering. Nothing is released to students until you make it.`}
        action={
          <Link
            href="/teacher/reviews"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open review queue
          </Link>
        }
      >
        <DataTable
          caption="AI suggestions awaiting review"
          columns={reviewColumns}
          rows={attention.rows}
          getRowId={(row) => `${row.assessment.id}:${row.student.id}`}
          rowActions={(row) => (
            <Link
              href="/teacher/reviews"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              aria-label={`Review ${row.assessment.title} for ${row.student.fullName}`}
            >
              Review
            </Link>
          )}
          empty={
            <EmptyState
              title="Nothing waiting"
              description="Every AI suggestion in this offering has been accepted, overridden or rejected."
            />
          }
        />
        {attention.total > attention.rows.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the {attention.rows.length} highest-priority items of {attention.total}.
          </p>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Cohort trend"
          description="Mean score by teaching week. A week with no assessed work is left blank."
        >
          {hasTrendData(overview.trend.series) ? (
            <>
              <TrendChart data={cohortTrendPoints(overview.trend.series)} />
              <p className="mt-3 text-xs text-muted-foreground">
                {overview.trend.series?.weeks ?? 0} teaching weeks · {overview.trend.markedCount}{" "}
                released marks.
              </p>
            </>
          ) : (
            <EmptyState
              title="No trend yet"
              description={
                overview.trend.series === null
                  ? "This offering has no term window, so there is no axis to bucket the cohort's marks against."
                  : "No released marks fall inside the term window yet."
              }
            />
          )}
        </SectionCard>

        <SectionCard
          title="Upcoming"
          description={
            upcoming.length === 0
              ? "Nothing is scheduled on your teaching calendar."
              : `The next ${upcoming.length} entries from your teaching calendar.`
          }
          action={
            <Link
              href="/teacher/planner"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Planner
            </Link>
          }
        >
          {upcomingItems.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="There are no upcoming classes, deadlines or reminders."
            />
          ) : (
            <Timeline items={upcomingItems} />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Assessment progress"
        description="Marking progress per assessment. An unreleased assessment stays invisible to students even once it is marked."
        action={
          <Link
            href="/teacher/assignments"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Manage assessments
          </Link>
        }
      >
        <DataTable
          caption="Assessment progress"
          columns={progressColumns}
          rows={progressRows}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              title="No assessments yet"
              description="Nothing has been added to this offering, so there is no marking progress to show. Create an assessment to start tracking it."
            />
          }
        />
      </SectionCard>
    </div>
  )
}
