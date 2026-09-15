import type { Metadata } from "next"
import { Play, ToggleLeft, Wrench } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { ProgressBar } from "../_components/mock-progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_ADMIN_TOOLS,
  MOCK_FEATURE_FLAGS,
  formatDateTime,
  formatRelativeTime,
  type AdminTool,
  type FeatureFlag,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Tools",
}

/**
 * Admin tools.
 *
 * Maintenance actions and feature flags. Every control is inert: a flag cannot be
 * flipped and a job cannot be started from a mockup, so each is rendered as a
 * disabled control with the real state still shown as a labelled pill (never by
 * colour alone). `lastRunAt: null` means the job has never been run.
 */
export default function AdminToolsPage() {
  const runningTool = MOCK_ADMIN_TOOLS.filter(
    (tool) => tool.state === "running" || tool.state === "queued",
  )
  const enabledFlags = MOCK_FEATURE_FLAGS.filter((flag) => flag.enabled)

  const toolColumns: Column<AdminTool>[] = [
    {
      id: "tool",
      header: "Action",
      cell: (row) => (
        <div className="min-w-0 max-w-md">
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground text-pretty">{row.description}</p>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      hideBelow: "md",
      cell: (row) => <Badge variant="outline">{row.category}</Badge>,
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
    {
      id: "lastRun",
      header: "Last run",
      hideBelow: "sm",
      cell: (row) =>
        row.lastRunAt ? (
          <div>
            <p>{formatRelativeTime(row.lastRunAt)}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(row.lastRunAt)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">Never run</span>
        ),
    },
    {
      id: "runBy",
      header: "Run by",
      hideBelow: "lg",
      cell: (row) => <span className="text-muted-foreground">{row.lastRunBy ?? "—"}</span>,
    },
  ]

  const flagColumns: Column<FeatureFlag>[] = [
    {
      id: "flag",
      header: "Flag",
      cell: (row) => (
        <div className="min-w-0 max-w-md">
          <p className="font-mono text-xs">{row.key}</p>
          <p className="text-xs text-muted-foreground text-pretty">{row.description}</p>
        </div>
      ),
    },
    {
      id: "owner",
      header: "Owner",
      hideBelow: "md",
      cell: (row) => <span className="text-muted-foreground">{row.owner}</span>,
    },
    {
      id: "rollout",
      header: "Rollout",
      cell: (row) => (
        <ProgressBar
          value={row.rolloutPercent}
          max={100}
          valueText={`${row.rolloutPercent}%`}
          tone={row.enabled ? "primary" : "warning"}
          className="w-36"
        />
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={row.enabled ? "active" : "archived"}
          dot
          label={row.enabled ? "Enabled" : "Disabled"}
        />
      ),
    },
    {
      id: "toggle",
      header: "Enabled",
      align: "center",
      cell: (row) => (
        <input
          type="checkbox"
          checked={row.enabled}
          readOnly
          disabled
          aria-label={`Enable ${row.key}`}
          className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Admin workspace", href: "/mockup/admin" },
          { label: "Tools" },
        ]}
        title="Tools"
        description="Maintenance actions, feature flags, and diagnostics."
        actions={
          <Button type="button" variant="outline">
            <Play className="size-4" aria-hidden="true" />
            Run health check
          </Button>
        }
      />

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Maintenance"
          description="Repeatable jobs with their last outcome. Jobs that have never run show “Never run”."
          action={<Wrench className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <DataTable
            caption="Maintenance actions"
            columns={toolColumns}
            rows={MOCK_ADMIN_TOOLS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No maintenance actions"
                description="Nothing is registered to run on this deployment."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Feature flags"
          description="Rollout state per flag. Toggles are inert in these mockups — the labelled state is the source of truth."
          action={<ToggleLeft className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <p className="mb-4 text-sm text-muted-foreground">
            {enabledFlags.length} of {MOCK_FEATURE_FLAGS.length} flags are enabled. A flag that is
            disabled so its rollout stands at 0% is shown as{" "}
            <span className="font-medium text-foreground">Disabled</span>, not as a hidden row.
          </p>
          <DataTable
            caption="Feature flags"
            columns={flagColumns}
            rows={MOCK_FEATURE_FLAGS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No feature flags"
                description="This deployment has no flags registered."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Recent runs"
          description={
            runningTool.length > 0
              ? `${runningTool.length} job${runningTool.length === 1 ? "" : "s"} currently in flight.`
              : "The most recent job outcomes, newest first."
          }
        >
          <Timeline items={buildRunItems()} />
        </SectionCard>
      </div>
    </>
  )
}

function buildRunItems(): TimelineItem[] {
  return MOCK_ADMIN_TOOLS.filter((tool) => tool.lastRunAt !== null)
    .slice()
    .sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""))
    .map((tool) => ({
      id: tool.id,
      title: tool.name,
      description: `${tool.category} · ${tool.lastRunBy ?? "unknown actor"}`,
      meta: tool.lastRunAt ? formatDateTime(tool.lastRunAt) : undefined,
      tone: tool.state,
    }))
}
