import type { Metadata } from "next"
import Link from "next/link"
import { Activity, Database, Layers, Share2, UserPlus, Users, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { Sparkline } from "@/components/ui/sparkline"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_ADMIN_DATASETS,
  MOCK_ADMIN_KPIS,
  MOCK_ADMIN_OFFERINGS,
  MOCK_ADMIN_SUMMARY,
  MOCK_ADMIN_USERS,
  MOCK_AUDIT_EVENTS,
  MOCK_EXPORT_ROWS,
  MOCK_SPARKLINES,
  formatDateTime,
  formatRelativeTime,
  type AdminOffering,
  type ExportRow,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Overview",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  kpi_users: Users,
  kpi_seats: Layers,
  kpi_datasets: Database,
  kpi_mappings: Share2,
}

/** Trend shapes that genuinely describe the metric they sit under. */
const KPI_SPARKLINES: Record<string, readonly number[]> = {
  kpi_users: MOCK_SPARKLINES.users,
}

type AttentionItem = {
  id: string
  status: StatusKey
  title: string
  detail: string
  href: string
}

/**
 * Admin overview.
 *
 * Platform health at a glance: KPI tiles from the shared admin fixtures, the
 * work that needs a human decision, then the two operational registers
 * (offerings and integrations) and the audit trail.
 */
export default function AdminOverviewPage() {
  const offerCapacity = MOCK_ADMIN_OFFERINGS.filter(
    (offering) => offering.state === "active",
  ).reduce((total, offering) => total + offering.capacity, 0)
  const attention = buildAttentionItems()

  const offeringColumns: Column<AdminOffering>[] = [
    {
      id: "offering",
      header: "Offering",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">
            {row.courseCode} · {row.courseName}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.section} · {row.term}
          </p>
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
      id: "enrolment",
      header: "Enrolment",
      cell: (row) => (
        <ProgressBar
          value={row.enrolled}
          max={row.capacity}
          valueText={`${row.enrolled} / ${row.capacity}`}
          tone={capacityTone(row.enrolled, row.capacity)}
          className="w-40"
        />
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
  ]

  const integrationColumns: Column<ExportRow>[] = [
    {
      id: "integration",
      header: "Integration",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.platform}</p>
          <p className="text-xs text-muted-foreground">{row.target}</p>
        </div>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      hideBelow: "lg",
      cell: (row) => <span className="text-muted-foreground">{row.course}</span>,
    },
    {
      id: "mapped",
      header: "Mapped",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.mappedUsers} / {row.totalUsers}
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} />,
    },
    {
      id: "lastSync",
      header: "Last sync",
      hideBelow: "sm",
      cell: (row) =>
        row.lastSyncedAt ? (
          <div>
            <p>{formatRelativeTime(row.lastSyncedAt)}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(row.lastSyncedAt)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">Never synced</span>
        ),
    },
    {
      id: "issues",
      header: "Issues",
      cell: (row) =>
        row.issues.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          <div>
            <p className="text-xs font-medium">
              {row.issues.length} open
              <span className="sr-only"> issue{row.issues.length === 1 ? "" : "s"}</span>
            </p>
            <p className="max-w-56 truncate text-xs text-muted-foreground">{row.issues[0]}</p>
          </div>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Mockup index", href: "/mockup" }, { label: "Admin workspace" }]}
        title="Overview"
        description="Platform health, term activity, and integration status."
        actions={
          <>
            <Button type="button" variant="outline">
              Export report
            </Button>
            <Button type="button">
              <UserPlus className="size-4" aria-hidden="true" />
              Invite user
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MOCK_ADMIN_KPIS.map((kpi) => (
          <StatCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            delta={kpi.delta}
            icon={KPI_ICONS[kpi.id]}
            sparkline={
              KPI_SPARKLINES[kpi.id] ? (
                <Sparkline
                  data={KPI_SPARKLINES[kpi.id]}
                  label={`${kpi.label} over the last six weeks`}
                />
              ) : undefined
            }
          />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Needs attention"
          description="Work waiting on an administrator, drawn from the users, dataset, and integration registers."
          action={<Activity className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          {attention.length === 0 ? (
            <EmptyState
              size="sm"
              title="Nothing needs a decision"
              description="Every account, dataset, and integration is in its expected state."
            />
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusPill status={item.status} dot />
                      <p className="text-sm font-medium">{item.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground text-pretty">{item.detail}</p>
                  </div>
                  <Link
                    href={item.href}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Offerings at a glance"
          description={`${MOCK_ADMIN_SUMMARY.activeOfferings} active offerings · ${MOCK_ADMIN_SUMMARY.seatsUsed} of ${offerCapacity} seats filled this term.`}
          action={
            <Link
              href="/mockup/admin/offerings"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              All offerings
            </Link>
          }
        >
          <DataTable
            caption="Course offerings"
            columns={offeringColumns}
            rows={MOCK_ADMIN_OFFERINGS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No offerings yet"
                description="Create an offering to start enrolling students."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Integration health"
          description="Roster sync and grade passback targets. Rows with open issues are the ones to act on."
        >
          <DataTable
            caption="Integration health"
            columns={integrationColumns}
            rows={MOCK_EXPORT_ROWS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No integrations configured"
                description="Register an LMS before grades can leave the platform."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Recent platform activity"
          description="The newest high-trust mutations from the audit trail."
        >
          <Timeline items={buildActivityItems()} />
        </SectionCard>
      </div>
    </>
  )
}

function capacityTone(enrolled: number, capacity: number) {
  if (capacity > 0 && enrolled / capacity >= 0.9) return "warning" as const
  return "primary" as const
}

/** Only surface a row when the underlying register actually has something to fix. */
function buildAttentionItems(): AttentionItem[] {
  const pending = MOCK_ADMIN_USERS.filter((user) => user.state === "pending")
  const neverSignedIn = MOCK_ADMIN_USERS.filter((user) => user.lastLoginAt === null)
  const datasets = MOCK_ADMIN_DATASETS.filter((dataset) => dataset.state === "needs-review")
  const failing = MOCK_EXPORT_ROWS.filter((row) => row.state === "failed")

  const items: AttentionItem[] = []

  if (pending.length > 0) {
    items.push({
      id: "pending-users",
      status: "pending",
      title: `${pending.length} account${pending.length === 1 ? "" : "s"} pending activation`,
      detail: pending.map((user) => user.name).join(", "),
      href: "/mockup/admin/users",
    })
  }

  if (neverSignedIn.length > 0) {
    items.push({
      id: "never-signed-in",
      status: "needs-review",
      title: `${neverSignedIn.length} account${neverSignedIn.length === 1 ? "" : "s"} have never signed in`,
      detail: neverSignedIn.map((user) => user.name).join(", "),
      href: "/mockup/admin/users",
    })
  }

  if (datasets.length > 0) {
    items.push({
      id: "datasets",
      status: "needs-review",
      title: `${datasets.length} dataset${datasets.length === 1 ? "" : "s"} need review`,
      detail: datasets.map((dataset) => dataset.name).join(", "),
      href: "/mockup/admin/data",
    })
  }

  if (failing.length > 0) {
    items.push({
      id: "failing-integrations",
      status: "failed",
      title: `${failing.length} integration${failing.length === 1 ? "" : "s"} failing`,
      detail: failing.map((row) => `${row.platform} — ${row.target}`).join(", "),
      href: "/mockup/admin/tools",
    })
  }

  return items
}

function buildActivityItems(): TimelineItem[] {
  return MOCK_AUDIT_EVENTS.slice(0, 5).map((event) => ({
    id: event.id,
    title: <span className="font-mono text-xs">{event.action}</span>,
    description: event.summary,
    meta: `${event.actorName} · ${event.actorRole.toLowerCase()} · ${formatRelativeTime(event.createdAt)}`,
    tone: event.tone,
  }))
}
