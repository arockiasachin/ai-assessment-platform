import type { Metadata } from "next"
import { Building2, Plug, ShieldCheck } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { MOCK_ADMIN_SUMMARY, MOCK_COURSE, MOCK_EXPORT_ROWS, type ExportRow } from "@/lib/mock"

export const metadata: Metadata = {
  title: "Settings",
}

/** Worst-first ordering so a platform row reports the state that needs attention. */
const STATE_SEVERITY: StatusKey[] = ["failed", "needs-review", "pending", "published", "completed"]

type PlatformSummary = {
  id: string
  platform: string
  targets: number
  mappedUsers: number
  totalUsers: number
  state: StatusKey
}

/**
 * Admin settings.
 *
 * Institution-wide defaults, the access policy that governs sign-in, and the
 * registration summary for the LMS integrations. All controls are inert
 * mockups; nothing here writes to a backend.
 */
export default function AdminSettingsPage() {
  const platforms = summarisePlatforms()

  const platformColumns: Column<PlatformSummary>[] = [
    {
      id: "platform",
      header: "Platform",
      cell: (row) => <span className="font-medium">{row.platform}</span>,
    },
    {
      id: "targets",
      header: "Targets",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.targets}</span>,
    },
    {
      id: "mapping",
      header: "Users mapped",
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
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Admin workspace", href: "/mockup/admin" },
          { label: "Settings" },
        ]}
        title="Settings"
        description="Institution defaults, integrations, and access policy."
        actions={
          <Button type="button" variant="outline" disabled>
            Save changes
          </Button>
        }
      />

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Institution defaults"
          description="Applied to every offering unless a course overrides them."
          action={<Building2 className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              { id: "institution", label: "Institution", value: "Vellore Institute of Technology" },
              { id: "year", label: "Academic year", value: String(MOCK_COURSE.academicYear) },
              { id: "term", label: "Active term", value: MOCK_COURSE.term },
              {
                id: "timezone",
                label: "Timezone",
                value: "Asia/Kolkata (UTC+05:30)",
                hint: "Deadlines and retention windows are stored in UTC.",
              },
              {
                id: "grading",
                label: "Grading scale",
                value: "Percentage · 10-point letter bands",
                hint: "Pass mark 40%. Overridable per course.",
              },
              {
                id: "dates",
                label: "Date format",
                value: "15 Sep 2026",
                hint: "Day-month-year, English (United Kingdom).",
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Access policy"
          description="How accounts are created and how long a session lasts."
          action={<ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              {
                id: "provisioning",
                label: "Role provisioning",
                value: "Registrar import, plus administrator-issued invitations",
                hint: "Teachers and students cannot self-provision a role.",
              },
              {
                id: "accounts",
                label: "Provisioned accounts",
                value: `${MOCK_ADMIN_SUMMARY.activeUsers} active · ${MOCK_ADMIN_SUMMARY.pendingUsers} pending`,
              },
              {
                id: "session",
                label: "Session length",
                value: "12 hours",
                hint: "Idle sessions are signed out automatically.",
              },
              {
                id: "invite",
                label: "Invitation expiry",
                value: "7 days",
                hint: "Expired invitations must be reissued by an administrator.",
              },
              {
                id: "mfa",
                label: "Multi-factor authentication",
                value: <StatusPill status="active" dot label="Required for administrators" />,
              },
              {
                id: "password",
                label: "Password policy",
                value: "Minimum 12 characters",
                hint: "Checked against a breach list at reset time.",
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Integrations"
          description="OneRoster and LTI 1.3 registrations, summarised per platform."
          action={<Plug className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <div className="space-y-4">
            <DataTable
              caption="Integration registrations"
              columns={platformColumns}
              rows={platforms}
              getRowId={(row) => row.id}
              empty={
                <EmptyState
                  size="sm"
                  title="No integrations registered"
                  description="Register a platform before grades can be passed back."
                />
              }
            />
            <div className="divide-y divide-border">
              <MetricRow
                label="OneRoster version"
                value="1.2"
                hint="Roster and line-item endpoints."
              />
              <MetricRow
                label="LTI version"
                value="1.3 with AGS"
                hint="Assignment and grade services for passback."
              />
              <MetricRow
                label="Signing key rotation"
                value="Manual"
                hint="The key reference is stored, never the key itself."
              />
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  )
}

function summarisePlatforms(): PlatformSummary[] {
  const platforms = Array.from(new Set(MOCK_EXPORT_ROWS.map((row: ExportRow) => row.platform)))

  return platforms.map((platform) => {
    const rows = MOCK_EXPORT_ROWS.filter((row) => row.platform === platform)
    const states = rows.map((row) => row.state)
    const state =
      STATE_SEVERITY.find((candidate) => states.includes(candidate)) ?? rows[0]?.state ?? "pending"

    return {
      id: `platform-${platform.toLowerCase()}`,
      platform,
      targets: rows.length,
      mappedUsers: rows.reduce((total, row) => total + row.mappedUsers, 0),
      totalUsers: rows.reduce((total, row) => total + row.totalUsers, 0),
      state,
    }
  })
}
