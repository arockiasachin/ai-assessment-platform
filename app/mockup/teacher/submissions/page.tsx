import type { Metadata } from "next"
import { CheckCheck, ClipboardList, Clock, EyeOff, Share2 } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_SUBMISSIONS,
  formatDateTime,
  formatPoints,
  formatRelativeTime,
  type SubmissionRow,
} from "@/lib/mock"

import { ASSESSMENT_KIND_LABEL, SUBMISSION_STATE_TO_STATUS } from "../_lib/labels"

export const metadata: Metadata = {
  title: "Submissions",
}

const HREF = "/mockup/teacher/submissions"

const SUBMITTED = MOCK_SUBMISSIONS.filter((row) => row.submittedAt !== null).length
const LATE = MOCK_SUBMISSIONS.filter((row) => row.late).length
const GRADED = MOCK_SUBMISSIONS.filter((row) => row.state === "GRADED").length
/** Marked, but the assessment has not been published — students cannot see it. */
const UNRELEASED = MOCK_SUBMISSIONS.filter((row) => row.points !== null && !row.published)

/**
 * Submissions — every piece of student work with its marking and release state.
 *
 * The state that matters most here is "marked but not released": the mark exists,
 * a teacher has approved it, and the student still cannot see it because the
 * assessment has not been published.
 */
export default function TeacherSubmissionsPage() {
  const columns: Column<SubmissionRow>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[16rem] truncate font-medium" title={row.studentName}>
            {row.studentName}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.versionCount > 1 ? `${row.versionCount} versions` : "First submission"}
          </p>
        </div>
      ),
    },
    {
      id: "assessment",
      header: "Assessment",
      hideBelow: "lg",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[20rem] truncate text-muted-foreground" title={row.assessmentTitle}>
            {row.assessmentTitle}
          </p>
          <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <span className="inline-flex flex-col items-start gap-1">
          <StatusPill status={SUBMISSION_STATE_TO_STATUS[row.state]} dot />
          {row.late && <StatusPill status="late" label="Late" />}
        </span>
      ),
    },
    {
      id: "submitted",
      header: "Submitted",
      hideBelow: "md",
      cell: (row) =>
        row.submittedAt === null ? (
          <span className="text-muted-foreground">
            Never submitted
            <span className="sr-only"> — no submission on record</span>
          </span>
        ) : (
          <span className="text-muted-foreground" title={formatDateTime(row.submittedAt)}>
            {formatRelativeTime(row.submittedAt)}
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
          <StatusPill status="published" label="Published" dot />
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
          <span className="block max-w-[20rem] whitespace-normal text-xs text-muted-foreground">
            {row.feedback}
          </span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="Grading"
        title="Submissions"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Submissions" },
        ]}
        actions={
          <Button>
            <Share2 className="size-4" aria-hidden="true" />
            Export marks
          </Button>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Submitted"
            value={String(SUBMITTED)}
            hint={`Across ${MOCK_ASSESSMENTS.length} assessments`}
            icon={ClipboardList}
          />
          <StatCard
            label="Late"
            value={String(LATE)}
            hint="Submitted after the deadline"
            icon={Clock}
          />
          <StatCard
            label="Marked"
            value={String(GRADED)}
            hint="Mark finalised, with or without release"
            icon={CheckCheck}
          />
          <StatCard
            label="Marked, withheld"
            value={String(UNRELEASED.length)}
            hint="Approved but not visible to students yet"
            icon={EyeOff}
          />
        </div>

        <FilterBar
          searchLabel="Search submissions"
          searchPlaceholder="Search student or register number…"
          resultCount={MOCK_SUBMISSIONS.length}
          resultNoun="submission"
          selects={[
            {
              id: "filter-assessment",
              label: "Assessment",
              value: "all",
              options: [
                { value: "all", label: "All assessments" },
                ...MOCK_ASSESSMENTS.map((assessment) => ({
                  value: assessment.id,
                  label: assessment.title,
                })),
              ],
            },
            {
              id: "filter-state",
              label: "State",
              value: "all",
              options: [
                { value: "all", label: "All states" },
                { value: "DRAFT", label: "Draft (not submitted)" },
                { value: "SUBMITTED", label: "Submitted" },
                { value: "RESUBMITTED", label: "Resubmitted" },
                { value: "LATE", label: "Late" },
                { value: "GRADED", label: "Marked" },
              ],
            },
            {
              id: "filter-release",
              label: "Release",
              value: "all",
              options: [
                { value: "all", label: "Published and withheld" },
                { value: "published", label: "Published" },
                { value: "withheld", label: "Marked, withheld" },
                { value: "unmarked", label: "Not marked" },
              ],
            },
            {
              id: "filter-late",
              label: "Timing",
              value: "all",
              options: [
                { value: "all", label: "On time and late" },
                { value: "late", label: "Late only" },
                { value: "on-time", label: "On time only" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Submissions"
          description={`${SUBMITTED} submitted · ${GRADED} marked · ${UNRELEASED.length} marked but withheld from students. A mark is only visible to a student once its assessment is published.`}
        >
          <DataTable
            caption="Student submissions"
            columns={columns}
            rows={MOCK_SUBMISSIONS}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Open the submission from ${row.studentName}`}
              >
                Open
              </Button>
            )}
            empty={
              <EmptyState
                icon={ClipboardList}
                title="No submissions yet"
                description="Work appears here as soon as a student submits it."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
