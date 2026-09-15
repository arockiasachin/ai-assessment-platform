import type { Metadata } from "next"
import { FilePlus2 } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_MATERIALS,
  MOCK_RUBRIC,
  formatDate,
  formatDueLabel,
  formatPercent,
  formatPoints,
  type Assessment,
  type AssessmentKind,
} from "@/lib/mock"

import { ASSESSMENT_KIND_LABEL } from "../_lib/labels"
import { TeacherProgress } from "../_lib/teacher-progress"

export const metadata: Metadata = {
  title: "Assignments",
}

const HREF = "/mockup/teacher/assignments"

const TABS: { value: string; label: string; kind?: AssessmentKind }[] = [
  { value: "all", label: "All" },
  { value: "quiz", label: "Quiz", kind: "QUIZ" },
  { value: "descriptive", label: "Descriptive", kind: "DESCRIPTIVE" },
  { value: "code", label: "Code", kind: "CODE" },
  { value: "group", label: "Group project", kind: "GROUP_PROJECT" },
]

const RUBRIC_ASSESSMENTS = MOCK_ASSESSMENTS.filter(
  (assessment) => assessment.rubricId === MOCK_RUBRIC.id,
)
const INDEXED_MATERIALS = MOCK_MATERIALS.filter((material) => material.indexed).length

/**
 * Assignments — every assessment in the offering, in one table, sliced by type.
 *
 * The unpublished states are the point of this page: a draft quiz that students
 * cannot see yet, and a descriptive task whose marks exist but are withheld.
 */
export default function TeacherAssignmentsPage() {
  const columns: Column<Assessment>[] = [
    {
      id: "assessment",
      header: "Assessment",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[22rem] truncate font-medium" title={row.title}>
            {row.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {ASSESSMENT_KIND_LABEL[row.kind]} · {row.maxPoints} pts
            {row.rubricId ? ` · rubric: ${MOCK_RUBRIC.title}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "due",
      header: "Due",
      hideBelow: "sm",
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
      id: "submissions",
      header: "Submitted",
      hideBelow: "md",
      cell: (row) => (
        <TeacherProgress
          className="w-36"
          label="Submitted"
          value={row.submissionCount}
          max={row.expectedCount}
          valueText={formatPoints(row.submissionCount, row.expectedCount)}
          tone={row.submissionCount === row.expectedCount ? "success" : "primary"}
        />
      ),
    },
    {
      id: "mean",
      header: "Mean",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatPercent(row.averagePercent)}</span>
      ),
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

  const table = (rows: readonly Assessment[], caption: string) => (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      empty={
        <EmptyState
          title="No assessments of this type"
          description="Create one to see it listed here with its marking progress."
        />
      }
    />
  )

  return (
    <>
      <PageHeader
        eyebrow="Assessment authoring"
        title="Assignments"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Assignments" },
        ]}
        actions={
          <Button>
            <FilePlus2 className="size-4" aria-hidden="true" />
            New assessment
          </Button>
        }
      />

      <div className="space-y-6">
        <FilterBar
          searchLabel="Search assessments"
          searchPlaceholder="Search by title or rubric…"
          resultCount={MOCK_ASSESSMENTS.length}
          resultNoun="assessment"
          selects={[
            {
              id: "filter-type",
              label: "Type",
              value: "all",
              options: [
                { value: "all", label: "All types" },
                ...(["QUIZ", "DESCRIPTIVE", "CODE", "GROUP_PROJECT", "ASSIGNMENT"] as const).map(
                  (kind) => ({ value: kind, label: ASSESSMENT_KIND_LABEL[kind] }),
                ),
              ],
            },
            {
              id: "filter-status",
              label: "Status",
              value: "all",
              options: [
                { value: "all", label: "All statuses" },
                { value: "draft", label: "Draft" },
                { value: "in-progress", label: "In progress" },
                { value: "needs-review", label: "Needs review" },
                { value: "completed", label: "Completed" },
              ],
            },
            {
              id: "filter-release",
              label: "Release",
              value: "all",
              options: [
                { value: "all", label: "Published and draft" },
                { value: "published", label: "Published only" },
                { value: "unpublished", label: "Not published" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Assessments"
          description={`Weights sum to 100% of the final grade. ${RUBRIC_ASSESSMENTS.length} assessment uses the ${MOCK_RUBRIC.title} rubric; ${INDEXED_MATERIALS} indexed materials can ground generated questions.`}
        >
          <PageTabs
            className="[&_[data-slot=tabs-list]]:overflow-x-auto"
            items={TABS.map((tab) => ({
              value: tab.value,
              label: tab.label,
              count: tab.kind
                ? MOCK_ASSESSMENTS.filter((assessment) => assessment.kind === tab.kind).length
                : MOCK_ASSESSMENTS.length,
            }))}
            label="Assessment type"
          >
            {TABS.map((tab) => {
              const rows = tab.kind
                ? MOCK_ASSESSMENTS.filter((assessment) => assessment.kind === tab.kind)
                : MOCK_ASSESSMENTS
              return (
                <PageTabPanel key={tab.value} value={tab.value}>
                  {table(rows, tab.kind ? `${tab.label} assessments` : "All assessments")}
                </PageTabPanel>
              )
            })}
          </PageTabs>
        </SectionCard>
      </div>
    </>
  )
}
