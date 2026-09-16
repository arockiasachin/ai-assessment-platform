"use client"

import { useMemo, useState } from "react"
import { Gavel, History } from "lucide-react"

import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import { formatDateTime, formatPoints } from "@/lib/format"
import { GRADE_SOURCE_LABEL } from "@/lib/labels"
import type { GradeActivityItem } from "@/lib/observability/audit-view"
import type { GradingDecisionItem } from "@/lib/observability/grading-decisions"
import {
  activityActionOptions,
  actorKindOptions,
  filterActivity,
  isActivityFiltered,
  isAutomated,
  searchableText,
  type ActorKindFilter,
} from "@/lib/observability-view"

/**
 * The activity log: the audit trail of high-trust grading actions, plus every mark
 * a teacher changed rather than accepted.
 *
 * **Two mockup controls are deliberately absent.**
 *
 * - **"Export log"** had no write path — there is no audit-log export route — so it
 *   is not rendered. The Wave 1 dangling-affordance rule: a control that looks like
 *   it does something and does not is worse than no control.
 * - **A date-range filter** is omitted rather than rendered inert. The dataset is
 *   already bounded to the most recent `limit` rows for one offering (25 here), so a
 *   range filter would slice an already-truncated window and the count would read as
 *   complete when it is not. Actor and action filtering are real and wired.
 *
 * **Dates go through `formatDateTime`, never `toLocaleString()`.** The page this
 * replaces called `new Date(...).toLocaleString()` in render: implicit locale and the
 * server's time zone, which is the exact class of hydration mismatch this codebase
 * has already been bitten by twice. `formatDateTime` pins `en-GB` and UTC.
 *
 * Automated rows are labelled, and that is not decoration: a retention purge writes
 * to the same log as a teacher, and it must not read like a human decision.
 */

const ACTION_LABELS: Record<string, string> = {
  "grade_review.created": "Review opened",
  "grade_review.reopened": "Review reopened",
  "grade_review.accept": "AI suggestion accepted",
  "grade_review.override": "AI suggestion overridden",
  "grade_review.reject": "AI suggestion rejected",
  "grade_review.flag": "Flagged for review",
  "ai_suggestion.recorded": "AI suggestion recorded",
  "grade.ai_draft_created": "Draft grade created",
  "grade.ai_draft_updated": "Draft grade updated",
  "grade.published": "Grade published",
  "grade.manual_mark_published": "Manual mark published",
  "grade.manual_mark_updated": "Manual mark updated",
  "grade.manual_mark_cleared": "Manual mark cleared",
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/**
 * Tone per action, so the list is scannable without reading every label. A rejected
 * suggestion and a published grade should not look alike at a glance.
 */
const ACTION_TONES: Record<string, StatusKey> = {
  "grade_review.created": "pending",
  "grade_review.reopened": "pending",
  "grade_review.accept": "completed",
  "grade_review.override": "overridden",
  "grade_review.reject": "rejected",
  "grade_review.flag": "flagged",
  "ai_suggestion.recorded": "in-progress",
  "grade.published": "published",
  "grade.manual_mark_published": "published",
  "grade.manual_mark_updated": "overridden",
  "grade.manual_mark_cleared": "archived",
}

function actionTone(action: string): StatusKey {
  return ACTION_TONES[action] ?? "active"
}

/** The scalar fields of an audit summary, flattened for display. Never nested objects. */
function summaryText(item: GradeActivityItem): string | null {
  const summary = item.summary
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null

  const parts = Object.entries(summary as Record<string, unknown>)
    .filter(([, value]) => value === null || typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)

  return parts.length > 0 ? parts.join(" · ") : null
}

export function TeacherObservabilityView({
  activity,
  decisions,
}: {
  activity: GradeActivityItem[]
  decisions: GradingDecisionItem[]
}) {
  const [search, setSearch] = useState("")
  const [action, setAction] = useState("all")
  const [actorKind, setActorKind] = useState<ActorKindFilter>("all")

  const actionOptions = useMemo(() => activityActionOptions(activity, actionLabel), [activity])
  const actorOptions = useMemo(() => actorKindOptions(activity), [activity])
  const filtered = useMemo(
    () => filterActivity(activity, { search, action, actorKind }),
    [activity, search, action, actorKind],
  )
  const showFilteredEmpty = isActivityFiltered({ search, action, actorKind })

  const timelineItems: TimelineItem[] = filtered.map((item) => {
    const automated = isAutomated(item)
    const detail = summaryText(item)

    return {
      id: item.id,
      title: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{actionLabel(item.action)}</span>
          <StatusPill status={actionTone(item.action)} dot />
          {automated && <StatusPill status="queued" label="Automated worker" />}
        </span>
      ),
      description: detail ?? undefined,
      meta: `${item.actorName ?? (automated ? "automated worker" : "unknown actor")} · ${
        automated ? "not staff" : (item.actorRole ?? "staff")
      } · ${formatDateTime(item.createdAt)} · ${item.entityLabel}`,
      tone: actionTone(item.action),
    }
  })

  const decisionColumns: Column<GradingDecisionItem>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => <span className="font-medium">{row.studentName}</span>,
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
        <span className="font-mono text-xs tabular-nums">
          {formatPoints(row.points, row.maxPoints)}
        </span>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: (row) => (
        <StatusPill
          status="overridden"
          // The stored enum is not shown raw; the shared map is the one place the
          // wording lives.
          label={GRADE_SOURCE_LABEL[row.source as keyof typeof GRADE_SOURCE_LABEL] ?? row.source}
          dot
        />
      ),
    },
    {
      id: "approved",
      header: "Approved by",
      hideBelow: "lg",
      cell: (row) =>
        row.approvedBy === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span>{row.approvedBy}</span>
        ),
    },
    {
      id: "release",
      header: "Release",
      cell: (row) =>
        // A null `publishedAt` is a mark the student cannot see yet, which is a real
        // state rather than missing data — so it gets a word, not an em dash.
        row.publishedAt === null ? (
          <StatusPill status="draft" label="Withheld" dot />
        ) : (
          <StatusPill status="published" label="Published" dot />
        ),
    },
    {
      id: "reason",
      header: "Reason recorded",
      hideBelow: "lg",
      cell: (row) =>
        row.overrideReason === null ? (
          // A manual mark with no note is legitimate, so this is an absence of a
          // note rather than a failure to load one.
          <span className="text-muted-foreground">No note</span>
        ) : (
          <span className="block max-w-96 text-xs whitespace-normal text-muted-foreground">
            {row.overrideReason}
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <FilterBar
        searchLabel="Search the log"
        searchPlaceholder="Search action, entity or summary…"
        searchValue={search}
        onSearchChange={setSearch}
        selects={[
          {
            id: "filter-actor-kind",
            label: "Actor",
            value: actorKind,
            options: actorOptions,
            onValueChange: (value) => setActorKind(value as ActorKindFilter),
          },
          {
            id: "filter-action",
            label: "Action",
            value: action,
            options: actionOptions,
            onValueChange: setAction,
          },
        ]}
        resultCount={filtered.length}
        resultNoun="entry"
        resultNounPlural="entries"
      />

      <SectionCard
        title="Activity"
        description="The audit trail for this offering, newest first. Entries written by an automated worker are labelled so they are not read as staff decisions."
        action={<History className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        {timelineItems.length === 0 ? (
          <EmptyState
            title={showFilteredEmpty ? "No entries match" : "No activity yet"}
            description={
              showFilteredEmpty
                ? "No entry matches the current search, action and actor filter. Clear the filters to see everything."
                : "No grade-pipeline activity has been recorded for this offering."
            }
          />
        ) : (
          <Timeline items={timelineItems} />
        )}
      </SectionCard>

      <SectionCard
        title="Grading decisions"
        description="Every mark a teacher changed rather than accepted, with the reason kept as calibration data."
        action={<Gavel className="size-4 text-muted-foreground" aria-hidden="true" />}
      >
        <DataTable
          caption="Teacher overrides"
          columns={decisionColumns}
          rows={decisions}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              title="No overrides recorded"
              description="Every AI suggestion on this offering has been accepted unchanged, and no mark was entered by hand."
            />
          }
        />
      </SectionCard>
    </div>
  )
}
