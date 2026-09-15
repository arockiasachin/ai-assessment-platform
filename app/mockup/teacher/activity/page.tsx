import type { Metadata } from "next"
import { Download, Gavel } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import { TruncatedText } from "@/components/ui/truncated-text"
import {
  MOCK_AUDIT_EVENTS,
  MOCK_COURSE,
  MOCK_GRADES,
  formatDateTime,
  formatPoints,
  formatPercent,
  type Grade,
} from "@/lib/mock"

import { GRADE_SOURCE_LABEL } from "../_lib/labels"

export const metadata: Metadata = {
  title: "Activity log",
}

const HREF = "/mockup/teacher/activity"

/** Newest first — the fixture is not ordered by time. */
const EVENTS = [...MOCK_AUDIT_EVENTS].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

const OVERRIDES = MOCK_GRADES.filter((grade) => grade.source === "TEACHER_OVERRIDE")

/**
 * Activity log — the audit trail of high-trust actions.
 *
 * Automated workers write to the same log as staff, so every entry labels the
 * actor's kind: a retention purge by a worker must not read like a teacher's
 * decision.
 */
export default function TeacherActivityPage() {
  const items: TimelineItem[] = EVENTS.map((event) => {
    const isAutomated = event.actorRole === "SYSTEM"
    return {
      id: event.id,
      title: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{event.action}</span>
          <StatusPill status={event.tone} dot />
          {isAutomated && <StatusPill status="queued" label="Automated worker" />}
        </span>
      ),
      description: event.summary,
      meta: `${event.actorName} · ${isAutomated ? "automated worker, not staff" : "staff"} · ${formatDateTime(
        event.createdAt,
      )} · ${event.entityType} ${event.entityId}`,
      tone: event.tone,
    }
  })

  const overrideColumns: Column<Grade>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <TruncatedText width="lg" className="font-medium" title={row.studentName}>
          {row.studentName}
        </TruncatedText>
      ),
    },
    {
      id: "assessment",
      header: "Assessment",
      hideBelow: "md",
      cell: (row) => <span className="text-muted-foreground">{row.assessmentTitle}</span>,
    },
    {
      id: "marks",
      header: "Final mark",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatPoints(row.points, row.maxPoints)}</span>
      ),
    },
    {
      id: "percent",
      header: "Percent",
      align: "right",
      hideBelow: "sm",
      cell: (row) => <span className="font-mono tabular-nums">{formatPercent(row.percent)}</span>,
    },
    {
      id: "source",
      header: "Source",
      cell: (row) => <StatusPill status="overridden" label={GRADE_SOURCE_LABEL[row.source]} dot />,
    },
    {
      id: "approved",
      header: "Approved by",
      hideBelow: "lg",
      cell: (row) => row.approvedBy ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "published",
      header: "Release",
      cell: (row) =>
        row.published ? (
          <StatusPill status="published" label="Published" dot />
        ) : (
          <StatusPill status="draft" label="Withheld" dot />
        ),
    },
    {
      id: "reason",
      header: "Reason recorded",
      hideBelow: "lg",
      cell: (row) => (
        <span className="block max-w-[24rem] whitespace-normal text-xs text-muted-foreground">
          {row.overrideReason ?? "—"}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · audit trail`}
        title="Activity log"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Activity log" },
        ]}
        actions={
          <Button variant="outline">
            <Download className="size-4" aria-hidden="true" />
            Export log
          </Button>
        }
      />

      <div className="space-y-6">
        <FilterBar
          searchLabel="Search the log"
          searchPlaceholder="Search action, entity or summary…"
          resultCount={EVENTS.length}
          resultNoun="entry"
          resultNounPlural="entries"
          selects={[
            {
              id: "filter-actor-kind",
              label: "Actor",
              value: "all",
              options: [
                { value: "all", label: "Staff and automated workers" },
                { value: "staff", label: "Staff only" },
                { value: "SYSTEM", label: "Automated workers only" },
                { value: "usr_teacher_01", label: "Dr. Meera Raman" },
              ],
            },
            {
              id: "filter-action",
              label: "Action",
              value: "all",
              options: [
                { value: "all", label: "All actions" },
                { value: "grade.override", label: "grade.override" },
                { value: "grade_review.auto_accept", label: "grade_review.auto_accept" },
                { value: "grade_review.reject", label: "grade_review.reject" },
                { value: "similarity.flag", label: "similarity.flag" },
                { value: "lms.passback.failed", label: "lms.passback.failed" },
                { value: "retention.purge", label: "retention.purge" },
              ],
            },
            {
              id: "filter-range",
              label: "Date range",
              value: "term",
              options: [
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "term", label: "Whole term" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Activity"
          description={`${EVENTS.length} entries, newest first. Entries written by an automated worker are labelled so they are not read as staff decisions.`}
        >
          <Timeline items={items} />
        </SectionCard>

        <SectionCard
          title="Grading decisions"
          description="Every mark a teacher changed rather than accepted, with the reason kept as calibration data."
          action={<Gavel className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <DataTable
            caption="Teacher overrides"
            columns={overrideColumns}
            rows={OVERRIDES}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No overrides recorded"
                description="Every AI suggestion on this offering has been accepted unchanged."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
