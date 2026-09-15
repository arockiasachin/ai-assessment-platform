import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Users,
  type LucideIcon,
} from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { Sparkline } from "@/components/ui/sparkline"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_COURSE,
  MOCK_DEMO_STUDENT,
  MOCK_GROUP_BY_ID,
  MOCK_MY_PEER_EVALUATIONS,
  MOCK_SPARKLINES,
  MOCK_STUDENT_ASSESSMENTS,
  MOCK_STUDENT_KPIS,
  MOCK_STUDENT_UPCOMING_EVENTS,
  formatDate,
  formatDateTime,
  formatDueLabel,
  type CalendarEventView,
  type StudentAssessmentRow,
} from "@/lib/mock"

import { ASSESSMENT_KIND_LABEL, StudentMark } from "./_lib/student-assessment"

export const metadata: Metadata = {
  title: "Dashboard",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  kpi_overall: BarChart3,
  kpi_due: CalendarClock,
  kpi_submitted: ClipboardList,
  kpi_peer: Users,
}

const EVENT_LABEL: Record<CalendarEventView["kind"], string> = {
  CLASS: "Class",
  ASSESSMENT: "Assessment",
  HOLIDAY: "Holiday",
  REMINDER: "Reminder",
}

const EVENT_TONE: Record<CalendarEventView["kind"], StatusKey> = {
  CLASS: "active",
  ASSESSMENT: "pending",
  HOLIDAY: "archived",
  REMINDER: "published",
}

/** Reviews each KPI tile gets a sparkline only where the shape is meaningful. */
function kpiSparkline(id: string) {
  if (id === "kpi_overall") {
    return <Sparkline data={MOCK_SPARKLINES.student} label="Your score trend over six weeks" />
  }
  if (id === "kpi_submitted") {
    return (
      <Sparkline
        data={MOCK_SPARKLINES.submissions}
        tone="success"
        label="Submissions recorded over six weeks"
      />
    )
  }
  return undefined
}

export default function StudentHomePage() {
  const student = MOCK_DEMO_STUDENT
  const team = student.groupId === null ? null : MOCK_GROUP_BY_ID[student.groupId]

  // Work the student still owes on an assessment that has been released.
  const dueNext = MOCK_STUDENT_ASSESSMENTS.filter(
    (row) => row.submittedAt === null && row.state !== "draft",
  ).sort((left, right) => left.dueAt.localeCompare(right.dueAt))

  const requiredPeerEvaluations =
    team === null ? 0 : team.members.filter((member) => member.studentId !== student.id).length
  const submittedPeerEvaluations = MOCK_MY_PEER_EVALUATIONS.filter(
    (evaluation) => evaluation.state === "SUBMITTED",
  ).length
  const outstandingPeerEvaluations = requiredPeerEvaluations - submittedPeerEvaluations
  const peerRound = team?.milestones.find((milestone) =>
    milestone.title.toLowerCase().includes("peer evaluation"),
  )

  const dueColumns: Column<StudentAssessmentRow>[] = [
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (row) => (
        <div>
          <p>{formatDate(row.dueAt)}</p>
          <p className="text-xs text-muted-foreground">{formatDueLabel(row.dueAt)}</p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
    {
      id: "marks",
      header: "Marks",
      align: "right",
      hideBelow: "sm",
      cell: (row) => <StudentMark row={row} />,
    },
  ]

  const upcomingItems: TimelineItem[] = MOCK_STUDENT_UPCOMING_EVENTS.map((event) => ({
    id: event.id,
    title: (
      <span className="flex flex-wrap items-center gap-2">
        {event.title}
        <StatusPill
          status={EVENT_TONE[event.kind]}
          label={EVENT_LABEL[event.kind]}
          className="text-[0.65rem]"
        />
      </span>
    ),
    description: event.detail,
    meta: `${formatDateTime(event.startAt)} · ${event.location ?? "No location set"}`,
    tone: EVENT_TONE[event.kind],
  }))

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Dashboard" },
        ]}
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Dashboard"
        description={`Welcome back, ${student.name}. What is due, what is graded, and what needs your attention.`}
        actions={
          <Link
            href="/mockup/student/assessments"
            className={buttonVariants({ variant: "outline" })}
          >
            All assessments
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {MOCK_STUDENT_KPIS.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              delta={kpi.delta}
              icon={KPI_ICONS[kpi.id]}
              sparkline={kpiSparkline(kpi.id)}
            />
          ))}
        </div>

        <SectionCard
          title="Due next"
          description="Assessments you still have to submit, soonest first. A draft that has not been released to students is not shown."
          action={
            <Link
              href="/mockup/student/assessments"
              className={buttonVariants({ variant: "link" })}
            >
              Open assessments
            </Link>
          }
        >
          <DataTable
            caption="Assessments you still have to submit"
            columns={dueColumns}
            rows={dueNext}
            getRowId={(row) => row.assessmentId}
            empty={
              <EmptyState
                size="sm"
                title="Nothing outstanding"
                description="Every released assessment has a submission from you."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Upcoming"
          description="Classes, deadlines and reminders from the course calendar."
          action={
            <Link href="/mockup/student/events" className={buttonVariants({ variant: "link" })}>
              Open calendar
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

        <SectionCard
          title="Peer evaluation"
          description="Rate every teammate on the five CATME dimensions. Your ratings are confidential — teammates only ever see an aggregate."
          action={
            <Link
              href="/mockup/student/peer-evaluation"
              className={buttonVariants({ variant: "link" })}
            >
              Open peer evaluation
            </Link>
          }
        >
          {team === null || requiredPeerEvaluations === 0 ? (
            <EmptyState
              icon={Users}
              title="No peer evaluation round"
              description="You are not in a team yet, so there is nobody to evaluate."
            />
          ) : (
            <div className="space-y-4">
              <ProgressBar
                value={submittedPeerEvaluations}
                max={requiredPeerEvaluations}
                label={`${team.name} · evaluations submitted`}
                valueText={`${submittedPeerEvaluations} / ${requiredPeerEvaluations}`}
                tone={outstandingPeerEvaluations === 0 ? "success" : "primary"}
              />
              <div className="space-y-0.5">
                <MetricRow
                  label="Round status"
                  value={
                    outstandingPeerEvaluations === 0 ? (
                      <StatusPill status="completed" label="All submitted" />
                    ) : (
                      <StatusPill
                        status="needs-review"
                        label={`${outstandingPeerEvaluations} still to rate`}
                      />
                    )
                  }
                />
                <MetricRow
                  label="Round closes"
                  value={
                    peerRound?.dueAt ? (
                      <span className="font-mono tabular-nums">{formatDate(peerRound.dueAt)}</span>
                    ) : (
                      "—"
                    )
                  }
                  hint={peerRound?.dueAt ? formatDueLabel(peerRound.dueAt) : "No date set yet"}
                />
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}
