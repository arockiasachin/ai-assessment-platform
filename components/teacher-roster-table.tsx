"use client"

import { useMemo, useState } from "react"
import { ClipboardCheck, Layers, UserMinus, Users } from "lucide-react"

import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { TeacherRosterRow } from "@/lib/teacher-roster"

/**
 * Class roster.
 *
 * The mockup's roster minus its two unservable columns — "Last active" (no
 * activity timestamp exists on any model) and "Standing" (real alerts are
 * offering-level, with no per-student flag). Four derived columns remain;
 * nothing here renders a number nothing derives.
 *
 * A client component only because it filters. Rows arrive as server props and are
 * narrowed locally, so there is no fetch and nothing to go stale.
 */
export function TeacherRosterTable({ rows }: { rows: TeacherRosterRow[] }) {
  // Default to every offering rather than the first one: a teacher with several
  // offerings would otherwise see one roster by default with no indication the
  // others existed. The mockup is single-course, but the data is not.
  const [offering, setOffering] = useState(ALL)
  const [query, setQuery] = useState("")
  const [marking, setMarking] = useState(ALL)

  const offeringOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows)
      if (!seen.has(row.offeringId)) seen.set(row.offeringId, row.offeringLabel)
    return [
      { value: ALL, label: "All offerings" },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  }, [rows])

  const scoped = useMemo(
    () => (offering === ALL ? rows : rows.filter((row) => row.offeringId === offering)),
    [rows, offering],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((row) => {
      if (marking === "marked" && row.avgPercent === null) return false
      if (marking === "unmarked" && row.avgPercent !== null) return false
      if (needle.length === 0) return true
      return (
        row.studentName.toLowerCase().includes(needle) ||
        (row.registerNumber ?? "").toLowerCase().includes(needle) ||
        (row.groupName ?? "").toLowerCase().includes(needle)
      )
    })
  }, [scoped, query, marking])

  // The tiles describe the selected offering, NOT the filtered view — so with the
  // Marking filter set to "Nothing released yet" the table can be all em dashes
  // while the Marked tile still reads its real count. That is deliberate (a tile
  // is a property of the cohort, not of the current search); `resultCount` is the
  // one figure that follows the filters.
  const enrolled = scoped.length
  // Scoped to the offering as well as the name: group names are unique only
  // within an offering (`@@unique([offeringId, name])`), so counting bare names
  // across offerings would undercount two teams that share a name.
  const groupsFormed = new Set(
    scoped
      .filter((row) => row.groupName !== null)
      .map((row) => `${row.offeringId}:${row.groupName}`),
  ).size
  const notPlaced = scoped.filter((row) => row.groupName === null).length
  const marked = scoped.filter((row) => row.avgPercent !== null).length

  const columns: Column<TeacherRosterRow>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium">{row.studentName}</TruncatedText>
          <p className="text-xs text-muted-foreground">{row.registerNumber ?? row.email}</p>
        </div>
      ),
    },
    {
      id: "group",
      header: "Group",
      cell: (row) =>
        row.groupName === null ? (
          <span className="text-muted-foreground">
            Not placed<span className="sr-only"> in a group</span>
          </span>
        ) : (
          <span>{row.groupName}</span>
        ),
    },
    {
      id: "average",
      header: "Average",
      align: "right",
      cell: (row) =>
        row.avgPercent === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only"> nothing marked yet</span>
          </span>
        ) : (
          <span className="font-mono tabular-nums">{row.avgPercent.toFixed(1)}%</span>
        ),
    },
    {
      id: "submitted",
      header: "Handed in",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.submittedCount} / {row.assessmentCount}
        </span>
      ),
    },
  ]

  if (rows.length === 0) {
    return (
      <SectionCard title="Roster">
        <EmptyState
          title="No enrolled students"
          description="Students appear here once they are enrolled in one of your offerings."
        />
      </SectionCard>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Enrolled" value={String(enrolled)} hint="Active enrolments" icon={Users} />
        <StatCard
          label="Groups formed"
          value={String(groupsFormed)}
          hint="Distinct teams"
          icon={Layers}
        />
        <StatCard
          label="Not placed"
          value={String(notPlaced)}
          hint="No group yet"
          icon={UserMinus}
        />
        <StatCard
          label="Marked"
          value={String(marked)}
          hint="At least one released mark"
          icon={ClipboardCheck}
        />
      </div>

      <FilterBar
        searchLabel="Search students"
        searchPlaceholder="Search student, register number or group…"
        searchValue={query}
        onSearchChange={setQuery}
        resultCount={filtered.length}
        resultNoun="student"
        selects={[
          {
            id: "filter-offering",
            label: "Offering",
            value: offering,
            options: offeringOptions,
            onValueChange: setOffering,
          },
          {
            id: "filter-marking",
            label: "Marking",
            value: marking,
            options: [
              { value: ALL, label: "Any marking" },
              { value: "marked", label: "Has a released mark" },
              { value: "unmarked", label: "Nothing released yet" },
            ],
            onValueChange: setMarking,
          },
        ]}
      />

      <SectionCard
        title="Roster"
        description="Actively enrolled students in the selected offering. Averages use released marks only."
      >
        <DataTable
          caption="Class roster"
          columns={columns}
          rows={filtered}
          getRowId={(row) => `${row.offeringId}:${row.studentId}`}
          hideCaption
          empty={
            <EmptyState
              title="No students match"
              description="Adjust the filters, or clear the search to see the whole roster."
            />
          }
        />
      </SectionCard>

      {notPlaced > 0 && (
        <p className="text-xs text-muted-foreground">
          {notPlaced} {notPlaced === 1 ? "student is" : "students are"} not in a group. Form teams
          on the Groups page.
        </p>
      )}
    </div>
  )
}

/** Sentinel for "no filter applied"; a real id is always a cuid-like string. */
const ALL = "all"
