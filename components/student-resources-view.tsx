"use client"

import { useMemo, useState } from "react"
import { Boxes, CircleCheck, Clock, Library, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { formatDate } from "@/lib/format"
import { MATERIAL_KIND_LABEL } from "@/lib/labels"
import type { MaterialView } from "@/lib/materials"
import {
  deriveMaterialKpis,
  filterMaterials,
  isFiltered,
  materialKindOptions,
  type MaterialKindFilter,
} from "@/lib/materials-view"

/**
 * The student's course materials.
 *
 * Server-fetched data, filtered here — the same split as `StudentCoursesView`.
 * The rows arrive as a prop, so there is no fetch-on-mount and no loading state.
 *
 * Three columns the mockup drew are **absent on purpose** (decisions M1 and M3):
 *
 * - **Topic.** There is no `topic` column and `metadata` is empty on every row. A
 *   material does not have a topic; a *question* does. The mockup's topic filter is
 *   therefore gone too, rather than rendered over a value that does not exist.
 * - **Size.** No file is stored, so there is no size to report. `sourceUrl` is an
 *   external link or nothing at all.
 * - **State.** There is no indexing pipeline state; `indexMaterial` is synchronous,
 *   so a material is indexed or it is not. The column collapses into the indexing
 *   cell, which reads "Not searchable yet" when there are no chunks.
 *
 * `chunks: 0` is shown as prose rather than as a number, because "0 chunks" reads
 * like a count while "Not searchable yet" says what it means. This is *not* the
 * em-dash case: zero chunks is a knowable fact, not a missing value.
 */

const KPI_ICONS: Record<string, LucideIcon> = {
  total: Library,
  indexed: CircleCheck,
  pending: Clock,
  chunks: Boxes,
}

const columns: Column<MaterialView>[] = [
  {
    id: "title",
    header: "Material",
    className: "max-w-96 whitespace-normal",
    cell: (row) => (
      <div className="min-w-0">
        {row.sourceUrl === null ? (
          // No stored file, and no link out either: say so rather than rendering
          // a dead or empty anchor.
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
        </p>
      </div>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    // A kind is not a status, so it does not borrow the status vocabulary or its
    // tones. This is the neutral outline treatment, labelled from the shared map.
    cell: (row) => <Badge variant="outline">{MATERIAL_KIND_LABEL[row.kind]}</Badge>,
  },
  {
    id: "course",
    header: "Course",
    hideBelow: "md",
    cell: (row) => <span className="font-mono text-xs">{row.courseCode}</span>,
  },
  {
    id: "indexing",
    header: "Indexing",
    cell: (row) => (
      <div className="space-y-1">
        {row.indexed ? (
          <StatusPill status="completed" label="Indexed" dot />
        ) : (
          <StatusPill status="pending" dot />
        )}
        <p className="text-xs text-muted-foreground">
          {row.indexed ? `${row.chunks} chunks` : "Not searchable yet"}
        </p>
      </div>
    ),
  },
  {
    id: "updated",
    header: "Updated",
    align: "right",
    hideBelow: "sm",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDate(row.updatedAt)}</span>
    ),
  },
]

export function StudentResourcesView({ materials }: { materials: MaterialView[] }) {
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<MaterialKindFilter>("all")

  const kindOptions = useMemo(() => materialKindOptions(materials), [materials])
  const filtered = useMemo(
    () => filterMaterials(materials, { search, kind }),
    [materials, search, kind],
  )
  const kpis = deriveMaterialKpis(materials)
  const showFilteredEmpty = isFiltered({ search, kind })

  const cards = [
    {
      id: "total",
      label: "Materials",
      value: String(kpis.total),
      hint: "On your courses' reading lists",
    },
    {
      id: "indexed",
      label: "Indexed",
      value: String(kpis.indexed),
      hint: "Searchable, and usable for practice and quizzes",
    },
    {
      id: "pending",
      label: "Pending indexing",
      value: String(kpis.pending),
      hint:
        kpis.pending === 0 ? "Everything is indexed" : "Not searchable until the index catches up",
    },
    {
      id: "chunks",
      label: "Retrieval chunks",
      value: String(kpis.chunks),
      hint:
        kpis.indexed === 1
          ? "Across 1 indexed material"
          : `Across ${kpis.indexed} indexed materials`,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            hint={card.hint}
            icon={KPI_ICONS[card.id]}
          />
        ))}
      </div>

      <FilterBar
        searchLabel="Search materials"
        searchPlaceholder="Search by title or course…"
        searchValue={search}
        onSearchChange={setSearch}
        selects={[
          {
            id: "material-kind",
            label: "Kind",
            value: kind,
            options: kindOptions,
            onValueChange: (value) => setKind(value as MaterialKindFilter),
          },
        ]}
        resultCount={filtered.length}
        resultNoun="material"
      />

      <SectionCard
        title="Materials"
        description="Everything your teachers have shared for your courses. A material that has not been indexed yet cannot be searched or used by the practice generator."
      >
        <DataTable
          caption="Course materials"
          columns={columns}
          rows={filtered}
          getRowId={(row) => row.id}
          empty={
            showFilteredEmpty ? (
              // Distinguished from the genuinely-empty case below, so a filter
              // that matches nothing does not read as "your teachers have posted
              // nothing".
              <EmptyState
                title="No materials match"
                description="No material matches the current search and kind filter. Clear the filters to see everything."
              />
            ) : (
              <EmptyState
                title="No materials yet"
                description="Your teachers have not shared any material for your courses."
              />
            )
          }
        />
      </SectionCard>
    </div>
  )
}
