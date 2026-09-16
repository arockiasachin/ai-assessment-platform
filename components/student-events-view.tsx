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
import { CALENDAR_KIND_LABEL, CALENDAR_KIND_TONE } from "@/lib/labels"

/**
 * The student's calendar.
 *
 * `upcoming` arrives as a prop rather than being computed here. That is deliberate:
 * `new Date()` in a client component is evaluated again during hydration, so an
 * event starting in the next second could be "upcoming" on the server and not in the
 * browser. Passing the server's answer down removes the whole class of mismatch —
 * and this codebase has already been bitten by a date-formatting hydration bug, so
 * the rule is that any clock-dependent list is decided once, on the server.
 *
 * **The Upcoming panel is not affected by the filters.** Its own description says
 * "the next few entries after today", so it is a time window rather than a filtered
 * view, and having it shrink as the user types would make it a worse answer to
 * "what is coming up". The table below is what the filters act on.
 *
 * Assessment events are **kept** here, unlike the teacher planner (decision E3
 * removes them there because a separate deadlines table owns them). A student's
 * calendar has no second table, so hiding deadlines would hide the point of it.
 */
export function StudentEventsView({
  events,
  upcoming,
}: {
  events: CalendarEventItem[]
  upcoming: CalendarEventItem[]
}) {
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<CalendarKindFilter>("all")
  const [month, setMonth] = useState("all")

  const kindOptions = useMemo(() => calendarKindOptions(events), [events])
  const monthOptions = useMemo(() => calendarMonthOptions(events), [events])
  const filtered = useMemo(
    () => filterCalendarEvents(events, { search, kind, month }),
    [events, search, kind, month],
  )
  const showFilteredEmpty = isFiltered({ search, kind, month })

  const timelineItems: TimelineItem[] = upcoming.map((event) => ({
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
    meta: `${formatDateTime(event.startAt)} · ${event.location ?? "No location set"}`,
    tone: CALENDAR_KIND_TONE[event.kind],
  }))

  return (
    <div className="space-y-6">
      <FilterBar
        searchLabel="Search events"
        searchPlaceholder="Search by title or location…"
        searchValue={search}
        onSearchChange={setSearch}
        selects={[
          {
            id: "event-month",
            label: "Month",
            value: month,
            options: monthOptions,
            onValueChange: setMonth,
          },
          {
            id: "event-kind",
            label: "Kind",
            value: kind,
            options: kindOptions,
            onValueChange: (value) => setKind(value as CalendarKindFilter),
          },
        ]}
        resultCount={filtered.length}
        resultNoun="event"
      />

      <SectionCard
        title="Upcoming"
        description="The next few entries after today. Assessments that have not been released to students are not listed."
      >
        {timelineItems.length === 0 ? (
          <EmptyState
            title="Nothing scheduled"
            description="There are no upcoming classes, deadlines or reminders."
          />
        ) : (
          <Timeline items={timelineItems} />
        )}
      </SectionCard>

      <SectionCard
        title="All events"
        description="The full calendar for the courses you are enrolled in, including entries that have already passed."
      >
        <DataTable
          caption="Course calendar events"
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          empty={
            showFilteredEmpty ? (
              <EmptyState
                size="sm"
                title="No events match"
                description="No event matches the current search, month and kind filter. Clear the filters to see everything."
              />
            ) : (
              <EmptyState
                size="sm"
                title="No events"
                description="Your courses have no calendar entries yet."
              />
            )
          }
        />
      </SectionCard>
    </div>
  )
}

const columns: Column<CalendarEventItem>[] = [
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
    cell: (row) => (
      <StatusPill status={CALENDAR_KIND_TONE[row.kind]} label={CALENDAR_KIND_LABEL[row.kind]} dot />
    ),
  },
  {
    id: "when",
    header: "When",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDateTime(row.startAt)}</span>
    ),
  },
  {
    // Header is "Class", not "Location": the value is derived from `classRoom.name`
    // (decision E2), so the honest name is the thing it actually is.
    id: "class",
    header: "Class",
    hideBelow: "sm",
    cell: (row) =>
      // Null is a real absence, not a zero, so it renders an em dash.
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
