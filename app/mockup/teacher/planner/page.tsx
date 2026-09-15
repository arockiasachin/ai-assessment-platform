import type { Metadata } from "next"
import { CalendarPlus } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_ASSESSMENTS,
  MOCK_CALENDAR_EVENTS,
  MOCK_COURSE,
  MOCK_UPCOMING_EVENTS,
  formatDate,
  formatDateTime,
  formatDueLabel,
  type Assessment,
  type CalendarEventView,
} from "@/lib/mock"

import { ASSESSMENT_KIND_LABEL, CALENDAR_KIND_LABEL, CALENDAR_KIND_TONE } from "../_lib/labels"

export const metadata: Metadata = {
  title: "Planner",
}

const HREF = "/mockup/teacher/planner"

/**
 * Planner — the teaching calendar.
 *
 * Dates always come from the fixture layer through `formatDate`/`formatDateTime`
 * so the server and the browser cannot disagree about a rendered date.
 */
export default function TeacherPlannerPage() {
  const eventColumns: Column<CalendarEventView>[] = [
    {
      id: "event",
      header: "Event",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[24rem] truncate font-medium" title={row.title}>
            {row.title}
          </p>
          <p className="text-xs text-muted-foreground">{row.courseCode ?? "No course"}</p>
        </div>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      cell: (row) => (
        <StatusPill
          status={CALENDAR_KIND_TONE[row.kind]}
          label={CALENDAR_KIND_LABEL[row.kind]}
          dot
        />
      ),
    },
    {
      id: "start",
      header: "Starts",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatDateTime(row.startAt)}
          <span className="block text-xs">{formatDueLabel(row.startAt)}</span>
        </span>
      ),
    },
    {
      id: "end",
      header: "Ends",
      hideBelow: "sm",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.endAt === null ? "—" : formatDateTime(row.endAt)}
        </span>
      ),
    },
    {
      id: "location",
      header: "Location",
      hideBelow: "md",
      cell: (row) =>
        row.location ?? (
          <span className="text-muted-foreground">
            —<span className="sr-only"> no location</span>
          </span>
        ),
    },
    {
      id: "detail",
      header: "Detail",
      hideBelow: "lg",
      cell: (row) => (
        <span className="block max-w-[22rem] whitespace-normal text-xs text-muted-foreground">
          {row.detail ?? "—"}
        </span>
      ),
    },
  ]

  const deadlineColumns: Column<Assessment>[] = [
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium" title={row.title}>
            {row.title}
          </p>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatDate(row.dueAt)}
          <span className="block text-xs">{formatDueLabel(row.dueAt)}</span>
        </span>
      ),
    },
    {
      id: "weight",
      header: "Weight",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.weightPercent}%</span>,
    },
    {
      id: "release",
      header: "Release",
      cell: (row) =>
        row.published ? (
          <StatusPill status="published" label="Published" dot />
        ) : (
          <StatusPill status="draft" label="Unpublished" dot />
        ),
    },
    {
      id: "state",
      header: "Progress",
      cell: (row) => <StatusPill status={row.state} dot />,
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
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Planner"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Planner" },
        ]}
        actions={
          <Button>
            <CalendarPlus className="size-4" aria-hidden="true" />
            Add event
          </Button>
        }
      />

      <div className="space-y-6">
        <FilterBar
          searchLabel="Search events"
          searchPlaceholder="Search by title or location…"
          resultCount={MOCK_CALENDAR_EVENTS.length}
          resultNoun="event"
          selects={[
            {
              id: "filter-month",
              label: "Month",
              value: "2026-09",
              options: [
                { value: "2026-08", label: "August 2026" },
                { value: "2026-09", label: "September 2026" },
                { value: "2026-10", label: "October 2026" },
                { value: "all", label: "Whole term" },
              ],
            },
            {
              id: "filter-kind",
              label: "Kind",
              value: "all",
              options: [
                { value: "all", label: "All kinds" },
                { value: "CLASS", label: "Classes" },
                { value: "ASSESSMENT", label: "Assessment deadlines" },
                { value: "REMINDER", label: "Reminders" },
                { value: "HOLIDAY", label: "Holidays" },
              ],
            },
          ]}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Upcoming" description="The next entries from the fixed mock clock.">
            <Timeline items={upcoming} />
          </SectionCard>

          <SectionCard
            title="All events"
            description={`${MOCK_CALENDAR_EVENTS.length} entries in ${MOCK_COURSE.term}, including institution holidays.`}
          >
            <DataTable
              caption="Course calendar"
              columns={eventColumns}
              rows={MOCK_CALENDAR_EVENTS}
              getRowId={(row) => row.id}
              empty={
                <EmptyState
                  title="Nothing scheduled"
                  description="Add a class, deadline or reminder to populate the calendar."
                  action={<Button>Add event</Button>}
                />
              }
            />
          </SectionCard>
        </div>

        <SectionCard
          title="Assessment deadlines"
          description="Every due date in the offering, with its release state — a draft deadline is not visible to students yet."
        >
          <DataTable
            caption="Assessment deadlines"
            columns={deadlineColumns}
            rows={MOCK_ASSESSMENTS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No assessments scheduled"
                description="Create an assessment to put a deadline on the calendar."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
