"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRightLeft,
  ClipboardCheck,
  Layers,
  Plus,
  Trash2,
  UserMinus,
  Users,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { Label } from "@/components/ui/label"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { TruncatedText } from "@/components/ui/truncated-text"
import type {
  RosterOfferingOption,
  RosterStudentOption,
  TeacherRosterRow,
} from "@/lib/teacher-roster"

/**
 * Class roster.
 *
 * ## One row per enrolment, with the offering named (TN-4)
 *
 * The same student enrolled in two of a teacher's offerings is two rows on purpose. An average
 * is per-offering — the audit's example (23BDA0001 twice, different averages) is a student with
 * two different marks in two different classes, and summarising those into one row would invent
 * a number or hide one of them. So the row *is* the enrolment, and an "Offering" column plus a
 * "Students" tile that counts people (not rows) is what makes the table read as what it is. The
 * previous tile counted rows and said "Enrolled", which is what made 48 rows look like 48 people.
 *
 * ## It has a write path (TN-9)
 *
 * Rows carry a move/remove action and the page carries an add form. Every mutation re-checks
 * ownership and capacity server-side; this component is presentation plus a fetch wrapper.
 *
 * The mockup's remaining two columns stay absent because nothing can derive them: "Last active"
 * (no activity timestamp exists on any model) and "Standing" (real alerts are offering-level).
 */
export function TeacherRosterTable({
  rows,
  students,
  offerings,
}: {
  rows: TeacherRosterRow[]
  /** Every student with an enrolment row in one of this teacher's offerings. */
  students: RosterStudentOption[]
  offerings: RosterOfferingOption[]
}) {
  const router = useRouter()
  // Default to every offering rather than the first one: a teacher with several
  // offerings would otherwise see one roster by default with no indication the
  // others existed. The mockup is single-course, but the data is not.
  const [offering, setOffering] = useState(ALL)
  const [query, setQuery] = useState("")
  const [marking, setMarking] = useState(ALL)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOfferingId, setAddOfferingId] = useState("")
  const [addStudentId, setAddStudentId] = useState("")

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
        (row.groupName ?? "").toLowerCase().includes(needle) ||
        row.offeringLabel.toLowerCase().includes(needle)
      )
    })
  }, [scoped, query, marking])

  // The tiles describe the selected offering, NOT the filtered view — so with the
  // Marking filter set to "Nothing released yet" the table can be all em dashes
  // while the Marked tile still reads its real count. That is deliberate (a tile
  // is a property of the cohort, not of the current search); `resultCount` is the
  // one figure that follows the filters.
  //
  // `enrolled` is rows (enrolments); `studentsInScope` is distinct people. Both are
  // shown, each labelled with what it counts.
  const enrolled = scoped.length
  const studentsInScope = new Set(scoped.map((row) => row.studentId)).size
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

  const effectiveAddOfferingId = addOfferingId || offerings[0]?.id || ""
  const addCandidates = useMemo(
    () => students.filter((student) => !student.activeOfferingIds.includes(effectiveAddOfferingId)),
    [students, effectiveAddOfferingId],
  )
  // Derive the selected student rather than syncing it in an effect: switching the target
  // offering can leave a stale id that is no longer a candidate.
  const effectiveAddStudentId = addCandidates.some((student) => student.id === addStudentId)
    ? addStudentId
    : (addCandidates[0]?.id ?? "")

  async function mutate(
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, string>,
    key: string,
    successMessage: string,
  ) {
    setBusyKey(key)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/classes/enrollments", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as {
        message?: string
        enrollment?: { changed?: boolean }
      }
      if (!response.ok) {
        setError(data.message ?? "Unable to update the enrolment.")
        return
      }
      setMessage(
        data.enrollment?.changed === false
          ? "No change — that student already had that enrolment."
          : successMessage,
      )
      router.refresh()
    } catch {
      setError("Unable to update the enrolment.")
    } finally {
      setBusyKey(null)
    }
  }

  function addStudent() {
    if (!effectiveAddOfferingId || !effectiveAddStudentId) return
    void mutate(
      "POST",
      { offeringId: effectiveAddOfferingId, studentId: effectiveAddStudentId },
      "add",
      "Student added to the offering.",
    )
  }

  function removeStudent(row: TeacherRosterRow) {
    void mutate(
      "DELETE",
      { offeringId: row.offeringId, studentId: row.studentId },
      `remove:${row.offeringId}:${row.studentId}`,
      "Student removed from the offering.",
    )
  }

  function moveStudent(row: TeacherRosterRow, toOfferingId: string) {
    if (!toOfferingId) return
    void mutate(
      "PATCH",
      { studentId: row.studentId, fromOfferingId: row.offeringId, toOfferingId },
      `move:${row.offeringId}:${row.studentId}`,
      "Student moved to the selected offering.",
    )
  }

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
      id: "offering",
      header: "Offering",
      hideBelow: "lg",
      cell: (row) => (
        <TruncatedText className="max-w-[16rem] text-xs text-muted-foreground">
          {row.offeringLabel}
        </TruncatedText>
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
      hideBelow: "sm",
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

  const otherOfferings = (row: TeacherRosterRow) =>
    offerings.filter((option) => option.id !== row.offeringId)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students"
          value={String(studentsInScope)}
          hint={`${enrolled} active enrolment${enrolled === 1 ? "" : "s"}`}
          icon={Users}
        />
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

      {message && (
        <p
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {offerings.length > 0 && students.length > 0 && (
        <SectionCard
          title="Add a student"
          description="Re-add a student who was moved away, or place one from another of your offerings. New registrations are handled by the registrar, not here."
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="grid gap-2">
              <Label htmlFor="roster-add-student">Student</Label>
              <Select
                value={effectiveAddStudentId}
                onValueChange={(value) => setAddStudentId(value ?? "")}
              >
                <SelectTrigger id="roster-add-student">
                  <SelectValue placeholder="Select a student" />
                </SelectTrigger>
                <SelectContent>
                  {addCandidates.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.name} ({student.registerNumber ?? student.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="roster-add-offering">Offering</Label>
              <Select
                value={effectiveAddOfferingId}
                onValueChange={(value) => setAddOfferingId(value ?? "")}
              >
                <SelectTrigger id="roster-add-offering">
                  <SelectValue placeholder="Select an offering" />
                </SelectTrigger>
                <SelectContent>
                  {offerings.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={addStudent}
                disabled={busyKey !== null || !effectiveAddStudentId || !effectiveAddOfferingId}
              >
                <Plus /> Add
              </Button>
            </div>
          </div>
          {addCandidates.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Every student already enrolled in one of your offerings is placed in this one.
            </p>
          )}
        </SectionCard>
      )}

      <FilterBar
        searchLabel="Search students"
        searchPlaceholder="Search student, register number, group or offering…"
        searchValue={query}
        onSearchChange={setQuery}
        resultCount={filtered.length}
        resultNoun={offering === ALL ? "enrolment" : "student"}
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
        description="Actively enrolled students in the selected offering — one row per enrolment, so a student in two of your offerings appears once per class. Averages use released marks only."
      >
        <DataTable
          caption="Class roster"
          columns={columns}
          rows={filtered}
          getRowId={(row) => `${row.offeringId}:${row.studentId}`}
          hideCaption
          rowActions={(row) => {
            const targets = otherOfferings(row)
            const rowBusy = busyKey?.endsWith(`${row.offeringId}:${row.studentId}`) ?? false
            return (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {targets.length > 0 && (
                  <Select value="" onValueChange={(value) => moveStudent(row, value ?? "")}>
                    <SelectTrigger
                      className="h-8 w-[11rem] text-xs"
                      aria-label={`Move ${row.studentName} to another offering`}
                      disabled={busyKey !== null}
                    >
                      <ArrowRightLeft className="size-3.5" />
                      <SelectValue placeholder="Move to…" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeStudent(row)}
                  disabled={busyKey !== null}
                  aria-label={`Remove ${row.studentName} from ${row.offeringLabel}`}
                >
                  <Trash2 />
                </Button>
                {rowBusy && <span className="sr-only">Updating…</span>}
              </div>
            )
          }}
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
          {notPlaced} {notPlaced === 1 ? "enrolment is" : "enrolments are"} not in a group. Form
          teams on the Groups page.
        </p>
      )}
    </div>
  )
}

/** Sentinel for "no filter applied"; a real id is always a cuid-like string. */
const ALL = "all"
