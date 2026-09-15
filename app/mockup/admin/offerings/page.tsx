import type { Metadata } from "next"
import { Layers, Plus, TriangleAlert, Users, Archive } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { MOCK_ADMIN_OFFERINGS, MOCK_COURSE, type AdminOffering } from "@/lib/mock"

export const metadata: Metadata = {
  title: "Course offerings",
}

const TERMS = Array.from(new Set(MOCK_ADMIN_OFFERINGS.map((offering) => offering.term)))
const COURSE_CODES = Array.from(
  new Set(MOCK_ADMIN_OFFERINGS.map((offering) => offering.courseCode)),
)

/**
 * Admin course offerings.
 *
 * One row per course section, with the capacity signal that drives staffing
 * decisions: an amber bar means the section is at or above 90% full, and a draft
 * section that has not been opened for enrolment shows a zero-width bar with an
 * explicit "awaiting enrolment" note rather than a bare `0`.
 */
export default function AdminOfferingsPage() {
  const active = MOCK_ADMIN_OFFERINGS.filter((offering) => offering.state === "active")
  const archived = MOCK_ADMIN_OFFERINGS.filter((offering) => offering.state === "archived")
  const seatsUsed = active.reduce((total, offering) => total + offering.enrolled, 0)
  const seatsTotal = active.reduce((total, offering) => total + offering.capacity, 0)
  const overCapacity = MOCK_ADMIN_OFFERINGS.filter(
    (offering) => offering.enrolled > offering.capacity,
  )
  const nearlyFull = MOCK_ADMIN_OFFERINGS.filter(
    (offering) =>
      offering.capacity > 0 &&
      offering.enrolled / offering.capacity >= 0.9 &&
      offering.enrolled <= offering.capacity,
  )

  const columns: Column<AdminOffering>[] = [
    {
      id: "offering",
      header: "Course",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">
            {row.courseCode} · {row.courseName}
          </p>
          <p className="text-xs text-muted-foreground">{row.section}</p>
        </div>
      ),
    },
    {
      id: "teacher",
      header: "Teacher",
      hideBelow: "md",
      cell: (row) => row.teacherName,
    },
    {
      id: "term",
      header: "Term",
      hideBelow: "lg",
      cell: (row) => <span className="text-muted-foreground">{row.term}</span>,
    },
    {
      id: "enrolment",
      header: "Enrolment",
      cell: (row) =>
        row.enrolled === 0 ? (
          <div className="w-44">
            <ProgressBar
              value={0}
              max={row.capacity}
              valueText={`0 / ${row.capacity}`}
              className="w-44"
            />
            <p className="mt-1 text-xs text-muted-foreground">Awaiting enrolment</p>
          </div>
        ) : (
          <ProgressBar
            value={row.enrolled}
            max={row.capacity}
            valueText={`${row.enrolled} / ${row.capacity}`}
            tone={
              row.enrolled / row.capacity >= 0.9 && row.enrolled <= row.capacity
                ? "warning"
                : "primary"
            }
            className="w-44"
          />
        ),
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
          { label: "Course offerings" },
        ]}
        title="Course offerings"
        description={`Courses, sections, teachers, and enrolment capacity. Active term: ${MOCK_COURSE.term}.`}
        actions={
          <Button type="button">
            <Plus className="size-4" aria-hidden="true" />
            Create offering
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active offerings"
          value={String(active.length)}
          hint={`Across ${COURSE_CODES.length} courses`}
          icon={Layers}
        />
        <StatCard
          label="Seats filled"
          value={`${seatsUsed} / ${seatsTotal}`}
          hint="Active sections only"
          icon={Users}
        />
        <StatCard
          label="Over capacity"
          value={String(overCapacity.length)}
          hint={
            overCapacity.length === 0
              ? `${nearlyFull.length} offering${nearlyFull.length === 1 ? "" : "s"} above 90% capacity`
              : "Move enrolments to a parallel section"
          }
          icon={TriangleAlert}
        />
        <StatCard
          label="Archived"
          value={String(archived.length)}
          hint="Past terms, read-only"
          icon={Archive}
        />
      </div>

      <div className="mt-6 space-y-6">
        <FilterBar
          searchLabel="Search offerings"
          searchPlaceholder="Search by course, teacher, or section…"
          selects={[
            {
              id: "filter-term",
              label: "Term",
              value: "all",
              options: [
                { value: "all", label: "All terms" },
                ...TERMS.map((term) => ({ value: term, label: term })),
              ],
            },
            {
              id: "filter-course",
              label: "Course",
              value: "all",
              options: [
                { value: "all", label: "All courses" },
                ...COURSE_CODES.map((code) => ({ value: code, label: code })),
              ],
            },
            {
              id: "filter-state",
              label: "State",
              value: "all",
              options: [
                { value: "all", label: "All states" },
                { value: "active", label: "Active" },
                { value: "draft", label: "Draft" },
                { value: "archived", label: "Archived" },
              ],
            },
          ]}
          resultCount={MOCK_ADMIN_OFFERINGS.length}
          resultNoun="offering"
        />

        <SectionCard
          title="Offerings"
          description="Draft sections are not visible to students until they are activated."
        >
          <DataTable
            caption="Course offerings"
            columns={columns}
            rows={MOCK_ADMIN_OFFERINGS}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={`Open ${row.courseCode} ${row.section}`}
              >
                Open
              </Button>
            )}
            empty={
              <EmptyState
                size="sm"
                title="No offerings match"
                description="Change the term, course, or state filter to see other sections."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
