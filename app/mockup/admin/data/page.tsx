import type { Metadata } from "next"
import { Clock, Database, HardDrive, TriangleAlert, Upload } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  MOCK_ADMIN_DATASETS,
  MOCK_ADMIN_OFFERINGS,
  MOCK_ADMIN_SUMMARY,
  MOCK_ADMIN_TOOLS,
  MOCK_ADMIN_USERS,
  MOCK_ASSESSMENTS,
  MOCK_AUDIT_EVENTS,
  MOCK_EXPORT_ROWS,
  MOCK_GRADES,
  MOCK_GRADE_SUGGESTIONS,
  MOCK_MATERIALS,
  MOCK_QUIZ_QUESTIONS,
  MOCK_REVIEW_QUEUE,
  MOCK_STUDENTS,
  MOCK_SUBMISSIONS,
  daysUntil,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  type AdminDataset,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Data",
}

const COUNT_FORMAT = new Intl.NumberFormat("en-GB")

type SystemTable = {
  id: string
  name: string
  description: string
  records: number
  source: string
  retention: string
  state: StatusKey
}

/**
 * Admin data.
 *
 * A system data overview: the imports the institution owns, every domain table
 * the platform holds (with its size, provenance, and retention class), and the
 * retention clock that governs student content. `retentionUntil: null` is the
 * important state — the clock has not started because results are unpublished,
 * so it must never be shown as a date or as zero.
 */
export default function AdminDataPage() {
  const sources = Array.from(new Set(MOCK_ADMIN_DATASETS.map((dataset) => dataset.source)))
  const totalRows = MOCK_ADMIN_DATASETS.reduce((total, dataset) => total + dataset.rowCount, 0)
  const withRetentionClock = MOCK_ADMIN_DATASETS.filter(
    (dataset) => dataset.retentionUntil !== null,
  )
  const nextPurge = withRetentionClock
    .slice()
    .sort((a, b) => (a.retentionUntil ?? "").localeCompare(b.retentionUntil ?? ""))[0]
  const retentionTool = MOCK_ADMIN_TOOLS.find((tool) => tool.id === "tool_retention_purge")
  const systemTables = buildSystemTables()

  const datasetColumns: Column<AdminDataset>[] = [
    {
      id: "dataset",
      header: "Dataset",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.source}</p>
        </div>
      ),
    },
    {
      id: "rows",
      header: "Rows",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{COUNT_FORMAT.format(row.rowCount)}</span>
      ),
    },
    {
      id: "owner",
      header: "Owner",
      hideBelow: "lg",
      cell: (row) =>
        row.owner === "integration-worker" ? (
          <span className="flex items-center gap-2">
            {row.owner}
            <StatusPill status="running" label="System" />
          </span>
        ) : (
          row.owner
        ),
    },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "sm",
      cell: (row) => (
        <div>
          <p>{formatRelativeTime(row.updatedAt)}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(row.updatedAt)}</p>
        </div>
      ),
    },
    {
      id: "retention",
      header: "Retention clock",
      cell: (row) =>
        row.retentionUntil ? (
          <div>
            <p>{formatDate(row.retentionUntil)}</p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(row.retentionUntil)}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-muted-foreground">Not started</p>
            <p className="text-xs text-muted-foreground">Results not published</p>
          </div>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
  ]

  const tableColumns: Column<SystemTable>[] = [
    {
      id: "table",
      header: "Table",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground text-pretty">{row.description}</p>
        </div>
      ),
    },
    {
      id: "records",
      header: "Records",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{COUNT_FORMAT.format(row.records)}</span>
      ),
    },
    {
      id: "source",
      header: "Source",
      hideBelow: "md",
      cell: (row) => <span className="text-muted-foreground">{row.source}</span>,
    },
    {
      id: "retention",
      header: "Retention class",
      hideBelow: "sm",
      cell: (row) => <Badge variant="outline">{row.retention}</Badge>,
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Admin workspace", href: "/mockup/admin" },
          { label: "Data" },
        ]}
        title="Data"
        description="Imported datasets, retention windows, and purge status across the platform."
        actions={
          <>
            <Button type="button" variant="outline">
              Export inventory
            </Button>
            <Button type="button">
              <Upload className="size-4" aria-hidden="true" />
              Import dataset
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Datasets"
          value={String(MOCK_ADMIN_DATASETS.length)}
          hint={`${MOCK_ADMIN_SUMMARY.datasetsNeedingReview} needs review`}
          icon={Database}
        />
        <StatCard
          label="Rows tracked"
          value={COUNT_FORMAT.format(totalRows)}
          hint="Across every tracked dataset"
          icon={HardDrive}
        />
        <StatCard
          label="Needs review"
          value={String(MOCK_ADMIN_SUMMARY.datasetsNeedingReview)}
          hint="Unmapped or unverified imports"
          icon={TriangleAlert}
        />
        <StatCard
          label="Retention due"
          value={String(withRetentionClock.length)}
          hint={
            nextPurge?.retentionUntil
              ? `Next purge ${formatDate(nextPurge.retentionUntil)}`
              : "No purge scheduled"
          }
          icon={Clock}
        />
      </div>

      <div className="mt-6 space-y-6">
        <FilterBar
          searchLabel="Search datasets"
          searchPlaceholder="Search by dataset, source, or owner…"
          selects={[
            {
              id: "filter-source",
              label: "Source",
              value: "all",
              options: [
                { value: "all", label: "All sources" },
                ...sources.map((source) => ({ value: source, label: source })),
              ],
            },
            {
              id: "filter-state",
              label: "State",
              value: "all",
              options: [
                { value: "all", label: "All states" },
                { value: "active", label: "Active" },
                { value: "needs-review", label: "Needs review" },
                { value: "archived", label: "Archived" },
              ],
            },
          ]}
          resultCount={MOCK_ADMIN_DATASETS.length}
          resultNoun="dataset"
        />

        <SectionCard
          title="Datasets"
          description="Everything the institution has imported, with the retention clock that applies to it."
        >
          <DataTable
            caption="Tracked datasets"
            columns={datasetColumns}
            rows={MOCK_ADMIN_DATASETS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No datasets tracked"
                description="Import a roster or grade export to begin."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Domain tables"
          description="What the platform stores, how large each table is, where the rows come from, and how they are governed."
        >
          <DataTable
            caption="Domain tables"
            columns={tableColumns}
            rows={systemTables}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No tables to show"
                description="This deployment has no domain records yet."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Retention"
          description="The clock that governs how long student content stays readable."
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 dark:bg-warning/15">
              <h3 className="text-sm font-semibold text-warning-foreground dark:text-warning">
                A dataset&rsquo;s clock only starts once its results are published
              </h3>
              <p className="mt-1 text-sm text-warning-foreground dark:text-warning">
                Student content is redacted 15 days after results are published. Datasets whose
                results are still unpublished show <span className="font-medium">Not started</span>{" "}
                rather than a purge date, because there is no date to show yet.
              </p>
            </div>

            <div className="divide-y divide-border">
              <MetricRow label="Retention window" value="15 days after publication" />
              <MetricRow
                label="Clocks running"
                value={`${withRetentionClock.length} of ${MOCK_ADMIN_DATASETS.length} datasets`}
                hint="The rest are pending publication"
              />
              <MetricRow
                label="Next purge"
                value={
                  nextPurge?.retentionUntil
                    ? `${formatDate(nextPurge.retentionUntil)} · ${formatRelativeTime(nextPurge.retentionUntil)}`
                    : "—"
                }
                hint={nextPurge?.name}
              />
              <MetricRow
                label="Last purge run"
                value={
                  retentionTool?.lastRunAt ? formatDateTime(retentionTool.lastRunAt) : "Never run"
                }
                hint={retentionTool?.lastRunBy ?? undefined}
              />
              <MetricRow
                label="Days until next purge"
                value={
                  nextPurge?.retentionUntil ? String(daysUntil(nextPurge.retentionUntil)) : "—"
                }
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  )
}

/** The platform's domain tables, sized from the fixtures the rest of the mockups render. */
function buildSystemTables(): SystemTable[] {
  return [
    {
      id: "accounts",
      name: "Accounts",
      description: "Staff, students, and administrators with sign-in access.",
      records: MOCK_ADMIN_USERS.length,
      source: "Platform",
      retention: "Institutional",
      state: "active",
    },
    {
      id: "offerings",
      name: "Course offerings",
      description: "Course sections, their teacher, and their capacity.",
      records: MOCK_ADMIN_OFFERINGS.length,
      source: "Platform",
      retention: "Institutional",
      state: "active",
    },
    {
      id: "students",
      name: "Student records",
      description: "Enrolments, register numbers, and group membership.",
      records: MOCK_STUDENTS.length,
      source: "Registrar import",
      retention: "Student content",
      state: "active",
    },
    {
      id: "assessments",
      name: "Assessments",
      description: "Quizzes, descriptive tasks, code tasks, and group projects.",
      records: MOCK_ASSESSMENTS.length,
      source: "Platform",
      retention: "Institutional",
      state: "published",
    },
    {
      id: "submissions",
      name: "Submissions",
      description: "Student work, including drafts and resubmissions.",
      records: MOCK_SUBMISSIONS.length,
      source: "Platform",
      retention: "Student content",
      state: "active",
    },
    {
      id: "grades",
      name: "Published grades",
      description: "Marks released to students. Unpublished marks are excluded.",
      records: MOCK_GRADES.filter((grade) => grade.published).length,
      source: "Platform",
      retention: "Student content",
      state: "published",
    },
    {
      id: "suggestions",
      name: "AI grade suggestions",
      description: "Model output with rationale, evidence, and prompt provenance.",
      records: MOCK_GRADE_SUGGESTIONS.length,
      source: "AI pipeline",
      retention: "Derived",
      state: "needs-review",
    },
    {
      id: "review-queue",
      name: "Review queue",
      description: "Suggestions still waiting on a teacher decision.",
      records: MOCK_REVIEW_QUEUE.length,
      source: "AI pipeline",
      retention: "Derived",
      state: "pending",
    },
    {
      id: "questions",
      name: "Quiz questions",
      description: "Published and draft items, including their answer keys.",
      records: MOCK_QUIZ_QUESTIONS.length,
      source: "Platform",
      retention: "Institutional",
      state: "published",
    },
    {
      id: "materials",
      name: "Course materials",
      description: "Documents, decks, and recordings, with their retrieval index state.",
      records: MOCK_MATERIALS.length,
      source: "Library",
      retention: "Licensed material",
      state: "active",
    },
    {
      id: "audit",
      name: "Audit events",
      description: "Append-only record of high-trust mutations.",
      records: MOCK_AUDIT_EVENTS.length,
      source: "Platform",
      retention: "Append-only",
      state: "active",
    },
    {
      id: "integrations",
      name: "Integration targets",
      description: "Roster sync and grade passback registrations.",
      records: MOCK_EXPORT_ROWS.length,
      source: "LMS",
      retention: "Integration",
      state: "active",
    },
  ]
}
