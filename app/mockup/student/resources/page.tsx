import type { Metadata } from "next"
import { Boxes, CircleCheck, Clock, Library, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_MATERIALS,
  MOCK_MATERIALS_SUMMARY,
  formatDate,
  type MaterialView,
} from "@/lib/mock"
import { MATERIAL_KIND_LABEL as KIND_LABEL } from "@/lib/labels"

export const metadata: Metadata = {
  title: "Resources",
}

/**
 * Design reference only. The real page is
 * `app/(dashboard)/student/resources/page.tsx`, which renders the same
 * composition from `lib/materials.ts`.
 *
 * This mockup still draws a **Topic** column and a **size**, which the real page
 * deliberately does not have: there is no topic column, and no file is stored so
 * there is no size (decisions M1, M3 in `docs/plans/wave-2.md`). The labels come
 * from the shared map so at least the wording cannot drift while this file is
 * still standing.
 */

/** Indexing state is a pipeline status, so it maps onto the shared vocabulary. */
const INDEX_STATUS: Record<string, StatusKey> = {
  pending: "pending",
  queued: "queued",
  completed: "completed",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  total: Library,
  indexed: CircleCheck,
  pending: Clock,
  chunks: Boxes,
}

const KIND_OPTIONS = [
  { value: "all", label: "All kinds" },
  ...(Object.keys(KIND_LABEL) as MaterialView["kind"][]).map((kind) => ({
    value: kind,
    label: KIND_LABEL[kind],
  })),
]

const TOPIC_OPTIONS = [
  { value: "all", label: "All topics" },
  ...Array.from(new Set(MOCK_MATERIALS.map((material) => material.topic))).map((topic) => ({
    value: topic,
    label: topic,
  })),
]

const columns: Column<MaterialView>[] = [
  {
    id: "title",
    header: "Material",
    className: "max-w-96 whitespace-normal",
    cell: (row) => (
      <div className="min-w-0">
        {row.sourceUrl === null ? (
          // No stored file: say so rather than rendering a dead link.
          <p className="font-medium">
            {row.title}
            <span className="ml-2 font-normal text-muted-foreground">No file attached</span>
          </p>
        ) : (
          <a
            href={row.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm font-medium hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {row.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <p className="text-xs text-muted-foreground">
          {row.mimeType === null ? "External link" : row.mimeType}
          {row.sizeLabel === null ? "" : ` · ${row.sizeLabel}`}
        </p>
      </div>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    cell: (row) => <StatusPill status="draft" label={KIND_LABEL[row.kind]} />,
  },
  {
    id: "topic",
    header: "Topic",
    hideBelow: "sm",
    cell: (row) => <span className="text-sm">{row.topic}</span>,
  },
  {
    id: "indexing",
    header: "Indexing",
    cell: (row) => (
      <div className="space-y-1">
        {row.indexed ? (
          <StatusPill status="completed" label="Indexed" dot />
        ) : (
          <StatusPill status={INDEX_STATUS[row.state] ?? "pending"} dot />
        )}
        <p className="text-xs text-muted-foreground">
          {/* An unindexed material has no chunks yet — show that, not a 0. */}
          {row.indexed ? `${row.chunks} chunks` : "Not searchable yet"}
        </p>
      </div>
    ),
  },
  {
    id: "updated",
    header: "Updated",
    align: "right",
    hideBelow: "md",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDate(row.updatedAt)}</span>
    ),
  },
]

export default function StudentResourcesPage() {
  const kpis = [
    {
      id: "total",
      label: "Materials",
      value: String(MOCK_MATERIALS_SUMMARY.total),
      hint: `On the ${MOCK_COURSE.code} reading list`,
    },
    {
      id: "indexed",
      label: "Indexed",
      value: String(MOCK_MATERIALS_SUMMARY.indexed),
      hint: "Searchable and usable for practice and quizzes",
    },
    {
      id: "pending",
      label: "Pending indexing",
      value: String(MOCK_MATERIALS_SUMMARY.pending),
      hint: "Not searchable until the index catches up",
    },
    {
      id: "chunks",
      label: "Retrieval chunks",
      value: String(MOCK_MATERIALS_SUMMARY.chunks),
      hint: `Across ${MOCK_MATERIALS_SUMMARY.indexed} indexed materials`,
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Resources" },
        ]}
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Resources"
        description="Course material, transcripts, and revision collections."
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              icon={KPI_ICONS[kpi.id]}
            />
          ))}
        </div>

        <FilterBar
          searchLabel="Search materials"
          searchPlaceholder="Search by title or topic…"
          selects={[
            { id: "material-kind", label: "Kind", value: "all", options: KIND_OPTIONS },
            { id: "material-topic", label: "Topic", value: "all", options: TOPIC_OPTIONS },
          ]}
          resultCount={MOCK_MATERIALS.length}
          resultNoun="material"
        />

        <SectionCard
          title="Materials"
          description="Everything your teacher has published for this course. A material that has not been indexed yet cannot be searched or used by the practice generator."
        >
          <DataTable
            caption="Course materials"
            columns={columns}
            rows={MOCK_MATERIALS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No materials yet"
                description="Your teacher has not published any material for this course."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
