"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CheckCheck, ClipboardList, Clock, EyeOff } from "lucide-react"

import { FilterBar } from "@/components/ui/filter-bar"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { TruncatedText } from "@/components/ui/truncated-text"
import { buttonVariants } from "@/components/ui/button"
import {
  ASSESSMENT_KIND_LABEL,
  SUBMISSION_STATE_LABEL,
  SUBMISSION_STATE_TO_STATUS,
} from "@/lib/labels"
import { formatDateTime, formatPoints } from "@/lib/mock/format"
import type { TeacherSubmissionRow } from "@/lib/teacher-submissions"

/**
 * Teacher submissions queue.
 *
 * A **client** component only because it filters: rows arrive as server props and
 * are narrowed locally, so there is no fetch and nothing to go stale. It is not a
 * grading surface — the per-row action links into the existing editor on
 * `/teacher/assignments`, which stays the only writer.
 *
 * Dates render absolutely, via the pinned-locale helpers. Relative time is
 * deliberately avoided: those helpers are anchored to the mockup's frozen clock,
 * and a real page must not imply a "2 days ago" the data cannot support.
 */
export function TeacherSubmissionsTable({ rows }: { rows: TeacherSubmissionRow[] }) {
  const [query, setQuery] = useState("")
  const [assessment, setAssessment] = useState(ALL)
  const [state, setState] = useState(ALL)
  const [release, setRelease] = useState(ALL)

  const assessmentOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of rows) seen.set(row.assessmentId, row.assessmentTitle)
    return [
      { value: ALL, label: "All assessments" },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ]
  }, [rows])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (assessment !== ALL && row.assessmentId !== assessment) return false
      if (state !== ALL && row.state !== state) return false
      if (release === "published" && !row.published) return false
      if (release === "withheld" && (row.published || row.points === null)) return false
      if (release === "unmarked" && row.points !== null) return false
      if (needle.length === 0) return true
      return (
        row.studentName.toLowerCase().includes(needle) ||
        (row.registerNumber ?? "").toLowerCase().includes(needle) ||
        row.assessmentTitle.toLowerCase().includes(needle)
      )
    })
  }, [rows, query, assessment, state, release])

  // "Submitted" means a submission actually exists. A row with
  // `submittedAt === null` is a saved draft (the student "Save draft" action
  // upserts exactly that), so counting rows would report a submission that was
  // never made — and the row right below it would contradict the tile by showing
  // State "Draft" with "—" for Submitted.
  const submitted = rows.filter((row) => row.submittedAt !== null).length
  const late = rows.filter((row) => row.state === "LATE").length
  const marked = rows.filter((row) => row.points !== null).length
  const withheld = rows.filter((row) => row.points !== null && !row.published).length

  const columns: Column<TeacherSubmissionRow>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium">{row.studentName}</TruncatedText>
          <p className="text-xs text-muted-foreground">
            {row.registerNumber ?? "No register number"}
            {row.versionCount > 1 ? ` · ${row.versionCount} versions` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium">{row.assessmentTitle}</TruncatedText>
          <p className="text-xs text-muted-foreground">
            {ASSESSMENT_KIND_LABEL[row.kind]} · {row.courseCode}
          </p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={SUBMISSION_STATE_TO_STATUS[row.state]}
          label={SUBMISSION_STATE_LABEL[row.state]}
          dot
        />
      ),
    },
    {
      id: "submitted",
      header: "Submitted",
      hideBelow: "md",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.submittedAt === null ? "—" : formatDateTime(row.submittedAt)}
        </span>
      ),
    },
    {
      id: "marks",
      header: "Marks",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatPoints(row.points, row.maxPoints)}</span>
      ),
    },
    {
      id: "release",
      header: "Release",
      cell: (row) =>
        row.published ? (
          <StatusPill status="published" label="Released" dot />
        ) : row.points === null ? (
          <StatusPill status="draft" label="Not marked" dot />
        ) : (
          <StatusPill status="pending" label="Marked, withheld" dot />
        ),
    },
    {
      id: "graded",
      header: "Marked at",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.gradedAt === null ? "—" : formatDateTime(row.gradedAt)}
        </span>
      ),
    },
    {
      id: "feedback",
      header: "Feedback",
      hideBelow: "lg",
      cell: (row) =>
        row.feedback === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only"> no feedback written yet</span>
          </span>
        ) : (
          <span className="block max-w-[20rem] text-xs whitespace-normal text-muted-foreground">
            {row.feedback}
          </span>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Submitted"
          value={String(submitted)}
          hint={
            assessmentOptions.length > 2
              ? `Across ${assessmentOptions.length - 1} assessments`
              : "Across your offerings"
          }
          icon={ClipboardList}
        />
        <StatCard
          label="Late"
          value={String(late)}
          hint="Submitted after the deadline"
          icon={Clock}
        />
        <StatCard
          label="Marked"
          value={String(marked)}
          hint="Mark finalised, with or without release"
          icon={CheckCheck}
        />
        <StatCard
          label="Marked, withheld"
          value={String(withheld)}
          hint="Approved but not visible to students yet"
          icon={EyeOff}
        />
      </div>

      <FilterBar
        searchLabel="Search submissions"
        searchPlaceholder="Search student, register number or assessment…"
        searchValue={query}
        onSearchChange={setQuery}
        resultCount={filtered.length}
        resultNoun="submission"
        selects={[
          {
            id: "filter-assessment",
            label: "Assessment",
            value: assessment,
            options: assessmentOptions,
            onValueChange: setAssessment,
          },
          {
            id: "filter-state",
            label: "State",
            value: state,
            options: [
              { value: ALL, label: "All states" },
              ...(["DRAFT", "SUBMITTED", "LATE", "GRADED", "RESUBMITTED"] as const).map(
                (value) => ({ value, label: SUBMISSION_STATE_LABEL[value] }),
              ),
            ],
            onValueChange: setState,
          },
          {
            id: "filter-release",
            label: "Release",
            value: release,
            options: [
              { value: ALL, label: "Any release" },
              { value: "published", label: "Released" },
              { value: "withheld", label: "Marked, withheld" },
              { value: "unmarked", label: "Not marked" },
            ],
            onValueChange: setRelease,
          },
        ]}
      />

      <SectionCard
        title="Submissions"
        description="Newest first. Open a submission in the assignments page to enter or change a mark."
      >
        <DataTable
          caption="Submissions across your offerings"
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          hideCaption
          rowActions={(row) => (
            // Named per row: "Open" repeated on every row gives a screen-reader
            // link list of identical labels with no way to choose. The href is
            // the assignments page because that is where the editor lives — this
            // queue is read-only (see docs/plans/wave-1.md §D2).
            <Link
              href="/teacher/assignments"
              aria-label={`Open ${row.studentName}'s submission for ${row.assessmentTitle} in assignments`}
              title={`Open in assignments: ${row.assessmentTitle}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open
            </Link>
          )}
          empty={
            <EmptyState
              title="No submissions match"
              description="Adjust the filters, or clear the search to see everything."
            />
          }
        />
      </SectionCard>
    </div>
  )
}

/** Sentinel for "no filter applied"; a real id is always a cuid-like string. */
const ALL = "all"
