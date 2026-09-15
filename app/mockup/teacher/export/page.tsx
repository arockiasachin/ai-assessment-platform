import type { Metadata } from "next"
import { CircleAlert, CircleCheck, CircleX, RefreshCw, UserRoundX } from "lucide-react"

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
  MOCK_EXPORT_ROWS,
  MOCK_EXPORT_SUMMARY,
  formatDateTime,
  formatRelativeTime,
  type ExportRow,
} from "@/lib/mock"
import { TeacherProgress } from "../_lib/teacher-progress"

export const metadata: Metadata = {
  title: "Export",
}

const HREF = "/mockup/teacher/export"

const ROWS_WITH_ISSUES = MOCK_EXPORT_ROWS.filter((row) => row.issues.length > 0)
const NEVER_SYNCED = MOCK_EXPORT_ROWS.filter((row) => row.lastSyncedAt === null)

/**
 * Export — LMS passback and mapping health.
 *
 * The two states that matter: a target that has never synced (so the row says
 * so rather than showing a blank date), and a FAILED row whose `issues` list is
 * the actionable content.
 */
export default function TeacherExportPage() {
  const columns: Column<ExportRow>[] = [
    {
      id: "target",
      header: "Target",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.target}</p>
          <p className="text-xs text-muted-foreground">
            {row.platform} · {row.course}
          </p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} dot />,
    },
    {
      id: "mapped",
      header: "Mapped users",
      cell: (row) => (
        <TeacherProgress
          className="w-36"
          label={`Mapped users — ${row.target}`}
          value={row.mappedUsers}
          max={row.totalUsers}
          valueText={`${row.mappedUsers} / ${row.totalUsers}`}
          tone={
            row.mappedUsers === row.totalUsers
              ? "success"
              : row.mappedUsers === 0
                ? "destructive"
                : "warning"
          }
        />
      ),
    },
    {
      id: "synced",
      header: "Last sync",
      hideBelow: "md",
      cell: (row) =>
        row.lastSyncedAt === null ? (
          <span className="text-muted-foreground">
            Never synced
            <span className="sr-only"> — no successful sync on record</span>
          </span>
        ) : (
          <span className="text-muted-foreground" title={formatDateTime(row.lastSyncedAt)}>
            {formatRelativeTime(row.lastSyncedAt)}
          </span>
        ),
    },
    {
      id: "issues",
      header: "Issues",
      hideBelow: "sm",
      cell: (row) =>
        row.issues.length === 0 ? (
          <StatusPill status="completed" label="No issues" dot />
        ) : (
          <ul className="max-w-[26rem] list-disc space-y-0.5 whitespace-normal pl-4 text-xs text-muted-foreground">
            {row.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ),
    },
    {
      id: "lineItems",
      header: "Line items",
      hideBelow: "lg",
      cell: (row) =>
        row.lineItemsUrl === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only"> no line-items URL published</span>
          </span>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">published</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow="LMS integration"
        title="Export"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Export" },
        ]}
        actions={
          <Button>
            <RefreshCw className="size-4" aria-hidden="true" />
            Sync now
          </Button>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Healthy"
            value={String(MOCK_EXPORT_SUMMARY.healthy)}
            hint="Roster and grades syncing normally"
            icon={CircleCheck}
          />
          <StatCard
            label="Needs attention"
            value={String(MOCK_EXPORT_SUMMARY.needsAttention)}
            hint="Queued or partially mapped"
            icon={CircleAlert}
          />
          <StatCard
            label="Failing"
            value={String(MOCK_EXPORT_SUMMARY.failing)}
            hint="Grades were not sent"
            icon={CircleX}
          />
          <StatCard
            label="Unmapped users"
            value={String(MOCK_EXPORT_SUMMARY.unmappedUsers)}
            hint="Accounts without an LMS identity"
            icon={UserRoundX}
          />
        </div>

        <FilterBar
          searchLabel="Search integrations"
          searchPlaceholder="Search target, platform or course…"
          resultCount={MOCK_EXPORT_ROWS.length}
          resultNoun="target"
          selects={[
            {
              id: "filter-platform",
              label: "Platform",
              value: "all",
              options: [
                { value: "all", label: "All platforms" },
                { value: "OneRoster", label: "OneRoster" },
                { value: "Canvas", label: "Canvas" },
                { value: "Moodle", label: "Moodle" },
              ],
            },
            {
              id: "filter-state",
              label: "State",
              value: "all",
              options: [
                { value: "all", label: "All states" },
                { value: "completed", label: "Completed" },
                { value: "published", label: "Published" },
                { value: "pending", label: "Pending" },
                { value: "needs-review", label: "Needs review" },
                { value: "failed", label: "Failed" },
              ],
            },
            {
              id: "filter-issues",
              label: "Issues",
              value: "all",
              options: [
                { value: "all", label: "With and without issues" },
                { value: "with", label: "With issues" },
                { value: "none", label: "No issues" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Integrations"
          description={`${MOCK_EXPORT_ROWS.length} sync targets. A partially mapped target cannot pass every grade back, so unmapped accounts are called out per row.`}
        >
          <DataTable
            caption="LMS export targets"
            columns={columns}
            rows={MOCK_EXPORT_ROWS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No integrations configured"
                description="Connect an LMS registration to export rosters and grades."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Action needed"
          description="Failures with their cause. A rotated signing key or an unmapped account has to be fixed before grades can leave the platform."
        >
          {ROWS_WITH_ISSUES.length === 0 ? (
            <EmptyState
              title="Everything is syncing"
              description="No target is reporting an issue."
            />
          ) : (
            <ul className="space-y-4">
              {ROWS_WITH_ISSUES.map((row) => (
                <li key={row.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">
                        {row.platform} — {row.target}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {row.course} ·{" "}
                        {row.lastSyncedAt === null
                          ? "never synced"
                          : `last synced ${formatDateTime(row.lastSyncedAt)}`}
                      </p>
                    </div>
                    <StatusPill status={row.state} dot />
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {row.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {NEVER_SYNCED.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {NEVER_SYNCED.length} target{NEVER_SYNCED.length === 1 ? " has" : "s have"} never
              synced: {NEVER_SYNCED.map((row) => row.target).join(", ")}.
            </p>
          )}
        </SectionCard>
      </div>
    </>
  )
}
