import type { Metadata } from "next"

import { PageHeader } from "@/components/shell/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_COURSE,
  MOCK_STUDENT_CALENDAR_EVENTS,
  MOCK_STUDENT_UPCOMING_EVENTS,
  formatDateTime,
  type CalendarEventView,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Events",
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

const EVENT_KIND_OPTIONS = [
  { value: "all", label: "All kinds" },
  ...(Object.keys(EVENT_LABEL) as CalendarEventView["kind"][]).map((kind) => ({
    value: kind,
    label: EVENT_LABEL[kind],
  })),
]

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

const MONTH_OPTIONS = [
  { value: "all", label: "All months" },
  ...Array.from(
    new Set(
      MOCK_STUDENT_CALENDAR_EVENTS.map((event) => monthFormatter.format(new Date(event.startAt))),
    ),
  ).map((month) => ({ value: month, label: month })),
]

const columns: Column<CalendarEventView>[] = [
  {
    id: "event",
    header: "Event",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{row.title}</p>
        <p className="text-xs text-muted-foreground">{row.detail ?? "No further detail"}</p>
      </div>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    cell: (row) => <StatusPill status={EVENT_TONE[row.kind]} label={EVENT_LABEL[row.kind]} dot />,
  },
  {
    id: "when",
    header: "When",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDateTime(row.startAt)}</span>
    ),
  },
  {
    id: "location",
    header: "Location",
    hideBelow: "sm",
    cell: (row) =>
      row.location === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span>{row.location}</span>
      ),
  },
  {
    id: "course",
    header: "Course",
    align: "right",
    hideBelow: "md",
    cell: (row) =>
      row.courseCode === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="font-mono text-xs">{row.courseCode}</span>
      ),
  },
]

export default function StudentEventsPage() {
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
          { label: "Events" },
        ]}
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Events"
        description="Classes, deadlines, and reminders in one calendar."
      />

      <div className="space-y-6">
        <FilterBar
          searchLabel="Search events"
          searchPlaceholder="Search by title or location…"
          selects={[
            { id: "event-month", label: "Month", value: "all", options: MONTH_OPTIONS },
            { id: "event-kind", label: "Kind", value: "all", options: EVENT_KIND_OPTIONS },
          ]}
          resultCount={MOCK_STUDENT_CALENDAR_EVENTS.length}
          resultNoun="event"
        />

        <SectionCard
          title="Upcoming"
          description="The next few entries after today. Assessments that have not been released to students are not listed."
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

        <SectionCard title="All events" description="The full course calendar for the term.">
          <DataTable
            caption="Course calendar events"
            columns={columns}
            rows={MOCK_STUDENT_CALENDAR_EVENTS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No events"
                description="This calendar has no entries for the current selection."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
