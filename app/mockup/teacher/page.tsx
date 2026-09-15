import type { Metadata } from "next"
import Link from "next/link"
import {
  BarChart3,
  CalendarDays,
  ClipboardCheck,
  FilePlus2,
  TrendingUp,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react"

import { TrendChart } from "@/components/charts"
import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { Sparkline } from "@/components/ui/sparkline"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_ASSESSMENTS,
  MOCK_COURSE,
  MOCK_PENDING_REVIEWS,
  MOCK_SCORE_TREND,
  MOCK_SPARKLINES,
  MOCK_TEACHER_KPIS,
  MOCK_UPCOMING_EVENTS,
  formatConfidence,
  formatDueLabel,
  formatDateTime,
  formatPercent,
  formatPoints,
  type Assessment,
  type ReviewQueueItem,
} from "@/lib/mock"

import {
  ASSESSMENT_KIND_LABEL,
  CALENDAR_KIND_LABEL,
  CALENDAR_KIND_TONE,
  REVIEW_STATE_LABEL,
  REVIEW_STATE_TO_STATUS,
} from "./_lib/labels"
import { ProgressBar } from "@/components/ui/progress-bar"

export const metadata: Metadata = {
  title: "Dashboard",
}

const HREF = "/mockup/teacher"

/** Which icon and sparkline series each KPI from the fixture gets. */
const KPI_ICONS: Record<string, LucideIcon> = {
  kpi_students: Users,
  kpi_average: TrendingUp,
  kpi_review: ClipboardCheck,
  kpi_at_risk: TriangleAlert,
}

const KPI_SPARKLINES: Record<
  string,
  {
    data: readonly number[]
    label: string
    tone: "primary" | "success" | "warning" | "destructive"
  }
> = {
  kpi_students: {
    data: MOCK_SPARKLINES.users,
    label: "Enrolments recorded over the last six weeks",
    tone: "primary",
  },
  kpi_average: {
    data: MOCK_SPARKLINES.cohort,
    label: "Cohort average over the last six weeks",
    tone: "primary",
  },
  kpi_review: {
    data: MOCK_SPARKLINES.reviewBacklog,
    label: "Review backlog over the last six weeks",
    tone: "warning",
  },
  kpi_at_risk: {
    data: MOCK_SPARKLINES.atRisk,
    label: "Students flagged at risk over the last six weeks",
    tone: "destructive",
  },
}

/**
 * Teacher dashboard — the term at a glance plus the two things that need a
 * decision today: the grading backlog and what is due next.
 */
export default function TeacherDashboardPage() {
  const attention = MOCK_PENDING_REVIEWS.slice(0, 5)

  const reviewColumns: Column<ReviewQueueItem>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={row.studentName}>
            {row.studentName}
          </p>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      id: "assessment",
      header: "Assessment",
      hideBelow: "md",
      cell: (row) => <span className="text-muted-foreground">{row.assessmentTitle}</span>,
    },
    {
      id: "why",
      header: "Why it is here",
      hideBelow: "lg",
      cell: (row) =>
        row.flags.length === 0 ? (
          <span className="text-muted-foreground">Below the confidence floor</span>
        ) : (
          <span className="text-xs text-muted-foreground">{row.flags.join(" · ")}</span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={REVIEW_STATE_TO_STATUS[row.state]}
          label={REVIEW_STATE_LABEL[row.state]}
          dot
        />
      ),
    },
    {
      id: "confidence",
      header: "Confidence",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatConfidence(row.confidence)}</span>
      ),
    },
  ]

  const assessmentColumns: Column<Assessment>[] = [
    {
      id: "title",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={row.title}>
            {row.title}
          </p>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      hideBelow: "sm",
      cell: (row) => <span className="text-muted-foreground">{formatDueLabel(row.dueAt)}</span>,
    },
    {
      id: "weight",
      header: "Weight",
      align: "right",
      hideBelow: "lg",
      cell: (row) => <span className="font-mono tabular-nums">{row.weightPercent}%</span>,
    },
    {
      id: "graded",
      header: "Marked",
      cell: (row) => (
        <ProgressBar
          className="w-36"
          label="Marked"
          value={row.gradedCount}
          max={row.submissionCount}
          valueText={`${row.gradedCount} / ${row.submissionCount}`}
          tone={row.gradedCount === row.submissionCount ? "success" : "primary"}
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
          {formatPoints(row.submissionCount, row.expectedCount)}
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
      cell: (row) => (
        <>
          <StatusPill status={row.state} dot />
          {!row.published && (
            <span className="mt-1 block text-xs text-muted-foreground">Not published</span>
          )}
        </>
      ),
    },
  ]

  const upcoming: TimelineItem[] = MOCK_UPCOMING_EVENTS.map((event) => ({
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
    meta: `${formatDateTime(event.startAt)} · ${formatDueLabel(event.startAt)}${
      event.location ? ` · ${event.location}` : ""
    }`,
    tone: CALENDAR_KIND_TONE[event.kind],
  }))

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.section} · ${MOCK_COURSE.term}`}
        title="Dashboard"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Dashboard" },
        ]}
        actions={
          <>
            <Button variant="outline">
              <FilePlus2 className="size-4" aria-hidden="true" />
              New assessment
            </Button>
            <Button>
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Publish results
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {MOCK_TEACHER_KPIS.map((kpi) => {
            const spark = KPI_SPARKLINES[kpi.id]
            return (
              <StatCard
                key={kpi.id}
                label={kpi.label}
                value={kpi.value}
                hint={kpi.hint}
                delta={kpi.delta}
                icon={KPI_ICONS[kpi.id] ?? BarChart3}
                sparkline={
                  spark ? (
                    <Sparkline data={spark.data} label={spark.label} tone={spark.tone} />
                  ) : undefined
                }
              />
            )
          })}
        </div>

        <SectionCard
          title="Needs your attention"
          description={`${MOCK_PENDING_REVIEWS.length} AI suggestions are waiting on a human decision. Nothing is released to students until you make it.`}
          action={
            <Link
              href="/mockup/teacher/reviews"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open review queue
            </Link>
          }
        >
          <DataTable
            caption="AI suggestions awaiting review"
            columns={reviewColumns}
            rows={attention}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Link
                href={`/mockup/teacher/reviews?student=${row.studentId}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                aria-label={`Review ${row.assessmentTitle} for ${row.studentName}`}
              >
                Review
              </Link>
            )}
            empty={
              <EmptyState
                title="Nothing waiting"
                description="Every AI suggestion has been accepted, overridden or rejected."
              />
            }
          />
          {MOCK_PENDING_REVIEWS.length > attention.length && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing the {attention.length} highest-priority items of {MOCK_PENDING_REVIEWS.length}
              .
            </p>
          )}
        </SectionCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Cohort trend"
            description="Mean score by teaching week, against the term target. Week 3 had no assessed work."
          >
            <TrendChart
              showAverage
              data={MOCK_SCORE_TREND.map((point) => ({
                label: point.period,
                value: point.value,
                average: point.average,
              }))}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Latest cohort mean {formatPercent(MOCK_COURSE.avgPercent)} across{" "}
              {MOCK_COURSE.studentCount} students.
            </p>
          </SectionCard>

          <SectionCard
            title="Upcoming"
            description={`The next ${MOCK_UPCOMING_EVENTS.length} entries from the course calendar.`}
            action={
              <Link
                href="/mockup/teacher/planner"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <CalendarDays className="size-3.5" aria-hidden="true" />
                Planner
              </Link>
            }
          >
            <Timeline items={upcoming} />
          </SectionCard>
        </div>

        <SectionCard
          title="Assessment progress"
          description="Marking progress per assessment. A draft stays invisible to students even once it is marked."
          action={
            <Link
              href="/mockup/teacher/assignments"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage assessments
            </Link>
          }
        >
          <DataTable
            caption="Assessment progress"
            columns={assessmentColumns}
            rows={MOCK_ASSESSMENTS}
            getRowId={(row) => row.id}
          />
        </SectionCard>
      </div>
    </>
  )
}
