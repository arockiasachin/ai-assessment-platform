"use client"

import Link from "next/link"
import { BarChart3, CalendarClock, ClipboardList, Users, type LucideIcon } from "lucide-react"

import { StatCard } from "@/components/stat-card"
import { buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CalendarEventItem } from "@/lib/calendar"
import type { StudentPeerEvaluationGroup } from "@/lib/contracts/groups"
import { formatDate, formatDateTime, formatPoints } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL, CALENDAR_KIND_LABEL, CALENDAR_KIND_TONE } from "@/lib/labels"
import type { StudentAssessmentItem, StudentAssessmentsPayload } from "@/lib/student-assessments"
import {
  dueLabel,
  outstandingAssessments,
  peerRoundSummaries,
  studentDashboardKpis,
  studentMarkState,
  SUBMISSION_STATE_LABEL,
  SUBMISSION_STATE_TO_STATUS,
  type StudentKpiId,
} from "@/lib/student-dashboard-view"

/**
 * The student dashboard, ported onto the mockup's composition.
 *
 * Four sections from `app/mockup/student/page.tsx`: the four KPI tiles, what is still
 * to submit, the upcoming calendar, and peer-evaluation progress. Everything is
 * server props — the gradebook context is no longer read here.
 *
 * ## Deliberate departures from the mockup
 *
 * - **No KPI sparklines** — there is no stored history of a student's score or
 *   submission count, so a sparkline could only be invented.
 * - **No "Round closes".** `StudentPeerEvaluationGroup` carries no milestone or due
 *   date. The mockup read that date from a team milestone; the workspace does not
 *   return one, so the row is dropped rather than filled with a guessed date.
 * - **No relative due label from the mockup's `formatDueLabel`.** That helper is
 *   anchored to the mockup's frozen clock; `dueLabel` here derives the same wording
 *   from the reader's own `daysUntilDue`.
 * - The mockup's `StudentMark` helper lives in the mockup tree, so the three-state
 *   mark cell is rebuilt from `studentMarkState` against the real payload.
 */

const KPI_ICONS: Record<StudentKpiId, LucideIcon> = {
  overall: BarChart3,
  "due-this-week": CalendarClock,
  submitted: ClipboardList,
  peer: Users,
}

function MarksCell({ assessment }: { assessment: StudentAssessmentItem }) {
  const state = studentMarkState(assessment)
  if (state === "withheld") {
    return <StatusPill status="pending" label="Mark not released" />
  }
  return (
    <span className="font-mono tabular-nums text-foreground">
      {state === "released"
        ? formatPoints(assessment.score, assessment.maxMarks)
        : formatPoints(null, assessment.maxMarks)}
    </span>
  )
}

export function StudentDashboard({
  payload,
  peerGroups,
  upcoming,
}: {
  payload: StudentAssessmentsPayload
  peerGroups: StudentPeerEvaluationGroup[]
  /** The next entries after the server's clock — computed by the page, not here. */
  upcoming: CalendarEventItem[]
}) {
  const assessments = payload.assessments
  const kpis = studentDashboardKpis({ assessments, groups: peerGroups })
  const dueNext = outstandingAssessments(assessments)
  const rounds = peerRoundSummaries(peerGroups)

  const dueColumns: Column<StudentAssessmentItem>[] = [
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium">{row.title}</TruncatedText>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.type]}</p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (row) => (
        <div>
          <p>{formatDate(row.dueDate)}</p>
          <p className="text-xs text-muted-foreground">{dueLabel(row)}</p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={SUBMISSION_STATE_TO_STATUS[row.submissionState]}
          label={SUBMISSION_STATE_LABEL[row.submissionState]}
          dot
        />
      ),
    },
    {
      id: "marks",
      header: "Marks",
      align: "right",
      hideBelow: "sm",
      cell: (row) => <MarksCell assessment={row} />,
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
          className="text-[0.65rem]"
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
        title="Due next"
        description="Assessments you still have to submit, soonest first."
        action={
          <Link href="/student/assessments" className={buttonVariants({ variant: "link" })}>
            Open assessments
          </Link>
        }
      >
        <DataTable
          caption="Assessments you still have to submit"
          columns={dueColumns}
          rows={dueNext}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              size="sm"
              title="Nothing outstanding"
              description={
                assessments.length === 0
                  ? "No assessments are assigned to your courses yet."
                  : "Every assessment on your courses has a submission from you."
              }
            />
          }
        />
      </SectionCard>

      <SectionCard
        title="Upcoming"
        description="Classes, deadlines and reminders from your course calendar."
        action={
          <Link href="/student/events" className={buttonVariants({ variant: "link" })}>
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
          <Link href="/student/peer-evaluation" className={buttonVariants({ variant: "link" })}>
            Open peer evaluation
          </Link>
        }
      >
        {rounds.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No peer evaluation round"
            description="You are not in a team yet, so there is nobody to evaluate."
          />
        ) : (
          <div className="space-y-6">
            {rounds.map((round) => (
              <div key={round.groupId} className="space-y-3">
                <p className="text-sm font-medium">
                  {round.courseCode} · {round.groupName}
                </p>
                <ProgressBar
                  value={round.submitted}
                  max={round.expected}
                  label="Evaluations submitted"
                  valueText={`${round.submitted} / ${round.expected}`}
                  tone={round.outstanding === 0 ? "success" : "primary"}
                />
                <div className="space-y-0.5">
                  <MetricRow
                    label="Round status"
                    value={
                      round.outstanding === 0 ? (
                        <StatusPill status="completed" label="All submitted" />
                      ) : (
                        <StatusPill
                          status="needs-review"
                          label={`${round.outstanding} still to rate`}
                        />
                      )
                    }
                  />
                  <MetricRow
                    label="Self-evaluation"
                    value={
                      <StatusPill
                        status={round.selfSubmitted ? "submitted" : "pending"}
                        label={round.selfSubmitted ? "Submitted" : "Not submitted"}
                      />
                    }
                  />
                  <MetricRow label="Results" value={round.resultsLabel} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
