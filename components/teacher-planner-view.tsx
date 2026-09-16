"use client"

import { useMemo, useState } from "react"

import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import type { CalendarEventItem } from "@/lib/calendar"
import {
  calendarKindOptions,
  calendarMonthOptions,
  filterCalendarEvents,
  isFiltered,
  type CalendarKindFilter,
} from "@/lib/calendar-view"
import { formatDateTime } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL, CALENDAR_KIND_LABEL, CALENDAR_KIND_TONE } from "@/lib/labels"
import {
  deadlineProgress,
  eventsExcludingAssessments,
  filterDeadlines,
  isDeadlineFiltered,
  releaseOptions,
  type ReleaseFilter,
} from "@/lib/planner-view"
import type { TeacherDeadlineItem } from "@/lib/teacher-planner"

/**
 * The teacher's planner: the teaching calendar plus the assessment deadlines.
 *
 * **There is no "Add event" button.** The mockup had one in the header and another
 * inside the events empty state, and neither had a write path — no calendar write
 * route exists anywhere under `app/api`. The Wave 1 dangling-affordance rule says such
 * a control is removed or disabled with an explanation, never left as a dead button,
 * so both are gone and the empty states say why the list is empty instead. A button
 * that looks like it creates an event and does not is worse than no button, because
 * it makes a missing feature look like a broken one.
 *
 * `upcoming` arrives as a prop, computed on the server against the server's clock —
 * the same reason as the student events page: a client-side `new Date()` is
 * re-evaluated during hydration and can disagree with the server's render.
 */
export function TeacherPlannerView({
  events,
  deadlines,
  upcoming,
}: {
  events: CalendarEventItem[]
  deadlines: TeacherDeadlineItem[]
  upcoming: CalendarEventItem[]
}) {
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<CalendarKindFilter>("all")
  const [month, setMonth] = useState("all")
  const [deadlineSearch, setDeadlineSearch] = useState("")
  const [release, setRelease] = useState<ReleaseFilter>("all")

  // Assessments are removed before anything else, so the kind filter is built from
  // a list in which "Assessment" cannot appear as a dead option (decision E3).
  const eventRows = useMemo(() => eventsExcludingAssessments(events), [events])
  const kindOptions = useMemo(() => calendarKindOptions(eventRows), [eventRows])
  const monthOptions = useMemo(() => calendarMonthOptions(eventRows), [eventRows])
  const filteredEvents = useMemo(
    () => filterCalendarEvents(eventRows, { search, kind, month }),
    [eventRows, search, kind, month],
  )
  const filteredDeadlines = useMemo(
    () => filterDeadlines(deadlines, { search: deadlineSearch, release }),
    [deadlines, deadlineSearch, release],
  )

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
    meta: `${formatDateTime(event.startAt)} · ${event.location ?? "No location set"}`,
    tone: CALENDAR_KIND_TONE[event.kind],
  }))

  const eventColumns: Column<CalendarEventItem>[] = [
    {
      id: "event",
      header: "Event",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.title}</p>
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
      id: "starts",
      header: "Starts",
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums">{formatDateTime(row.startAt)}</span>
      ),
    },
    {
      id: "ends",
      header: "Ends",
      hideBelow: "sm",
      cell: (row) =>
        row.endAt === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="font-mono text-xs tabular-nums">{formatDateTime(row.endAt)}</span>
        ),
    },
    {
      // "Class", not "Location": the value is `classRoom.name` and nothing else (E2).
      id: "class",
      header: "Class",
      hideBelow: "md",
      cell: (row) =>
        row.location === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span>{row.location}</span>
        ),
    },
  ]

  const deadlineColumns: Column<TeacherDeadlineItem>[] = [
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">
            {ASSESSMENT_KIND_LABEL[row.kind]} · {row.courseCode} · {row.maxMarks} marks
          </p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      cell: (row) => (
        <span className="font-mono text-xs tabular-nums">{formatDateTime(row.dueDate)}</span>
      ),
    },
    {
      id: "progress",
      header: "Progress",
      hideBelow: "sm",
      cell: (row) => <span className="text-xs text-muted-foreground">{deadlineProgress(row)}</span>,
    },
    {
      id: "release",
      header: "Release",
      cell: (row) =>
        row.released ? (
          <div className="space-y-1">
            <StatusPill status="published" label="Released" dot />
            <p className="text-xs text-muted-foreground">
              {row.releasedAt === null ? "—" : formatDateTime(row.releasedAt)}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <StatusPill status="draft" label="Not released" dot />
            <p className="text-xs text-muted-foreground">Hidden from students</p>
          </div>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Upcoming"
          description="The next few entries after today, including assessment deadlines."
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
          title="Assessment deadlines"
          description="Every due date you own, with its release state. An unreleased assessment is hidden from students but still listed here."
        >
          <FilterBar
            searchLabel="Search deadlines"
            searchPlaceholder="Search by title or course…"
            searchValue={deadlineSearch}
            onSearchChange={setDeadlineSearch}
            selects={[
              {
                id: "deadline-release",
                label: "Release",
                value: release,
                options: releaseOptions(),
                onValueChange: (value) => setRelease(value as ReleaseFilter),
              },
            ]}
            resultCount={filteredDeadlines.length}
            resultNoun="assessment"
          />
          <DataTable
            caption="Assessment deadlines"
            columns={deadlineColumns}
            rows={filteredDeadlines}
            getRowId={(row) => row.id}
            empty={
              isDeadlineFiltered({ search: deadlineSearch, release }) ? (
                <EmptyState
                  size="sm"
                  title="No assessments match"
                  description="No assessment matches the current search and release filter. Clear the filters to see everything."
                />
              ) : (
                <EmptyState
                  size="sm"
                  title="No assessments yet"
                  description="Assessments you own will appear here with their deadline and release state."
                />
              )
            }
          />
        </SectionCard>
      </div>

      <SectionCard
        title="All events"
        description="Classes, holidays and reminders on your offerings. Assessment deadlines have their own table above, so they are not repeated here."
      >
        <FilterBar
          searchLabel="Search events"
          searchPlaceholder="Search by title or class…"
          searchValue={search}
          onSearchChange={setSearch}
          selects={[
            {
              id: "planner-month",
              label: "Month",
              value: month,
              options: monthOptions,
              onValueChange: setMonth,
            },
            {
              id: "planner-kind",
              label: "Kind",
              value: kind,
              options: kindOptions,
              onValueChange: (value) => setKind(value as CalendarKindFilter),
            },
          ]}
          resultCount={filteredEvents.length}
          resultNoun="event"
        />
        <DataTable
          caption="Teaching calendar"
          columns={eventColumns}
          rows={filteredEvents}
          getRowId={(row) => row.id}
          empty={
            isFiltered({ search, kind, month }) ? (
              <EmptyState
                size="sm"
                title="No events match"
                description="No event matches the current search, month and kind filter. Clear the filters to see everything."
              />
            ) : (
              <EmptyState
                size="sm"
                title="No events"
                description="Your offerings have no calendar entries. There is no way to add one from here yet."
              />
            )
          }
        />
      </SectionCard>
    </div>
  )
}
