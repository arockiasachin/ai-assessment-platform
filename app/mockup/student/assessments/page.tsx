import type { Metadata } from "next"

import { PageHeader } from "@/components/shell/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_STUDENT_ASSESSMENTS,
  formatDate,
  formatDateTime,
  formatDueLabel,
  type StudentAssessmentRow,
} from "@/lib/mock"

import { ASSESSMENT_KIND_LABEL, StudentFeedback, StudentMark } from "../_lib/student-assessment"

export const metadata: Metadata = {
  title: "Assessments",
}

const TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "QUIZ", label: "Quiz" },
  { value: "DESCRIPTIVE", label: "Descriptive" },
  { value: "CODE", label: "Code task" },
  { value: "GROUP_PROJECT", label: "Group project" },
  { value: "ASSIGNMENT", label: "Assignment" },
]

const STATE_OPTIONS = [
  { value: "all", label: "All states" },
  { value: "todo", label: "To do" },
  { value: "submitted", label: "Submitted" },
  { value: "graded", label: "Graded" },
  { value: "unreleased", label: "Not released yet" },
]

/** Every row the student has, plus the three views the tabs need. */
const ALL_ROWS = MOCK_STUDENT_ASSESSMENTS
const TO_DO_ROWS = ALL_ROWS.filter((row) => row.submittedAt === null && row.state !== "draft")
const SUBMITTED_ROWS = ALL_ROWS.filter((row) => row.submittedAt !== null)
const GRADED_ROWS = ALL_ROWS.filter((row) => row.state === "graded")

const columns: Column<StudentAssessmentRow>[] = [
  {
    id: "assessment",
    header: "Assessment",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{row.title}</p>
        <p className="text-xs text-muted-foreground">{ASSESSMENT_KIND_LABEL[row.kind]}</p>
      </div>
    ),
  },
  {
    id: "due",
    header: "Due",
    cell: (row) => (
      <div>
        <p>{formatDate(row.dueAt)}</p>
        <p className="text-xs text-muted-foreground">{formatDueLabel(row.dueAt)}</p>
      </div>
    ),
  },
  {
    id: "state",
    header: "State",
    cell: (row) => (
      <StatusPill
        status={row.state}
        label={row.state === "draft" ? "Not released yet" : undefined}
        dot
      />
    ),
  },
  {
    id: "submitted",
    header: "Submitted",
    hideBelow: "lg",
    cell: (row) =>
      row.submittedAt === null ? (
        <span className="text-muted-foreground">Not submitted</span>
      ) : (
        <span className="font-mono text-xs tabular-nums">{formatDateTime(row.submittedAt)}</span>
      ),
  },
  {
    id: "marks",
    header: "Marks",
    align: "right",
    hideBelow: "sm",
    cell: (row) => <StudentMark row={row} />,
  },
  {
    id: "feedback",
    header: "Feedback",
    className: "max-w-72 whitespace-normal",
    cell: (row) => <StudentFeedback row={row} />,
  },
]

export default function StudentAssessmentsPage() {
  const tabs = [
    { value: "all", label: "All", count: ALL_ROWS.length },
    { value: "todo", label: "To do", count: TO_DO_ROWS.length },
    { value: "submitted", label: "Submitted", count: SUBMITTED_ROWS.length },
    { value: "graded", label: "Graded", count: GRADED_ROWS.length },
  ]

  const panels: { value: string; rows: StudentAssessmentRow[]; empty: React.ReactNode }[] = [
    {
      value: "all",
      rows: ALL_ROWS,
      empty: (
        <EmptyState
          size="sm"
          title="No assessments"
          description="Nothing is set for this course."
        />
      ),
    },
    {
      value: "todo",
      rows: TO_DO_ROWS,
      empty: (
        <EmptyState
          size="sm"
          title="Nothing to do"
          description="You have submitted everything that has been released."
        />
      ),
    },
    {
      value: "submitted",
      rows: SUBMITTED_ROWS,
      empty: (
        <EmptyState
          size="sm"
          title="Nothing submitted yet"
          description="Your submissions appear here as soon as they are handed in."
        />
      ),
    },
    {
      value: "graded",
      rows: GRADED_ROWS,
      empty: (
        <EmptyState
          size="sm"
          title="No marks yet"
          description="Marks appear here once your teacher has finalised the grading."
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Assessments" },
        ]}
        eyebrow={MOCK_COURSE.code}
        title="Assessments"
        description="Every assessment with due date, submission state, and marks."
      />

      <div className="space-y-6">
        <FilterBar
          searchLabel="Search assessments"
          searchPlaceholder="Search by title or topic…"
          selects={[
            { id: "assessment-type", label: "Type", value: "all", options: TYPE_OPTIONS },
            { id: "assessment-state", label: "Status", value: "all", options: STATE_OPTIONS },
          ]}
          resultCount={ALL_ROWS.length}
          resultNoun="assessment"
        />

        <SectionCard
          title="Your assessments"
          description="A mark is only shown once your teacher releases it; until then the row keeps its graded state with the number withheld."
        >
          <PageTabs items={tabs} label="Assessment views">
            {panels.map((panel) => (
              <PageTabPanel key={panel.value} value={panel.value}>
                <DataTable
                  caption={`${tabs.find((tab) => tab.value === panel.value)?.label ?? "All"} assessments`}
                  columns={columns}
                  rows={panel.rows}
                  getRowId={(row) => row.assessmentId}
                  empty={panel.empty}
                />
              </PageTabPanel>
            ))}
          </PageTabs>
        </SectionCard>
      </div>
    </>
  )
}
