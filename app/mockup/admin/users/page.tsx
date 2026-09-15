import type { Metadata } from "next"
import { History, LogIn, Users, UserPlus, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { ProgressBar } from "../_components/mock-progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ADMIN_USERS,
  formatDateTime,
  formatRelativeTime,
  initialsFromName,
  type AdminUser,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Users",
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  TEACHER: "Teacher",
  STUDENT: "Student",
}

const ROLE_ORDER = ["ADMIN", "TEACHER", "STUDENT"] as const

type AccountState = { key: AdminUser["state"]; label: string }

const STATE_ORDER: AccountState[] = [
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending activation" },
  { key: "archived", label: "Archived" },
]

/**
 * Admin users.
 *
 * The account register plus the composition an administrator actually cares
 * about: who is in which role, how many accounts are still waiting to be
 * activated, and who has never signed in (`lastLoginAt: null`).
 */
export default function AdminUsersPage() {
  const active = MOCK_ADMIN_USERS.filter((user) => user.state === "active")
  const pending = MOCK_ADMIN_USERS.filter((user) => user.state === "pending")
  const archived = MOCK_ADMIN_USERS.filter((user) => user.state === "archived")
  const neverSignedIn = MOCK_ADMIN_USERS.filter((user) => user.lastLoginAt === null)

  const kpis: { id: string; label: string; value: string; hint: string; icon: LucideIcon }[] = [
    {
      id: "active",
      label: "Active accounts",
      value: String(active.length),
      hint: `Across ${ROLE_ORDER.length} roles`,
      icon: Users,
    },
    {
      id: "pending",
      label: "Pending activation",
      value: String(pending.length),
      hint: pending[0] ? `Oldest: ${pending[0].name}` : "Nothing waiting",
      icon: UserPlus,
    },
    {
      id: "archived",
      label: "Archived",
      value: String(archived.length),
      hint: "Past staff, sign-in disabled",
      icon: History,
    },
    {
      id: "never-signed-in",
      label: "Never signed in",
      value: String(neverSignedIn.length),
      hint: "Provisioned but never used",
      icon: LogIn,
    },
  ]

  const roleCounts = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    count: MOCK_ADMIN_USERS.filter((user) => user.role === role).length,
  }))

  const columns: Column<AdminUser>[] = [
    {
      id: "account",
      header: "Account",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initialsFromName(row.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => <Badge variant="secondary">{ROLE_LABELS[row.role] ?? row.role}</Badge>,
    },
    {
      id: "offerings",
      header: "Offerings",
      align: "right",
      hideBelow: "md",
      cell: (row) => <span className="font-mono tabular-nums">{row.offerings}</span>,
    },
    {
      id: "lastLogin",
      header: "Last sign-in",
      hideBelow: "sm",
      cell: (row) =>
        row.lastLoginAt ? (
          <div>
            <p>{formatRelativeTime(row.lastLoginAt)}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(row.lastLoginAt)}</p>
          </div>
        ) : (
          <span className="text-muted-foreground">Never signed in</span>
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
          { label: "Users" },
        ]}
        title="Users"
        description="Accounts, roles, and last sign-in across the institution."
        actions={
          <Button type="button">
            <UserPlus className="size-4" aria-hidden="true" />
            Invite user
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <StatCard
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            icon={kpi.icon}
          />
        ))}
      </div>

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Access summary"
          description="Role composition and account lifecycle state across the institution."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Role distribution</h3>
              {roleCounts.map((entry) => (
                <ProgressBar
                  key={entry.role}
                  label={entry.label}
                  value={entry.count}
                  max={MOCK_ADMIN_USERS.length}
                  valueText={`${entry.count} of ${MOCK_ADMIN_USERS.length}`}
                />
              ))}
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Account states</h3>
              <ul className="space-y-2">
                {STATE_ORDER.map((state) => (
                  <li
                    key={state.key}
                    className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    <StatusPill status={state.key} dot label={state.label} />
                    <span className="font-mono text-sm tabular-nums">
                      {MOCK_ADMIN_USERS.filter((user) => user.state === state.key).length}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 pt-2">
                  <StatusPill status="pending" dot label="Never signed in" />
                  <span className="font-mono text-sm tabular-nums">{neverSignedIn.length}</span>
                </li>
              </ul>
            </div>
          </div>
        </SectionCard>

        <FilterBar
          searchLabel="Search accounts"
          searchPlaceholder="Search by name, email, or role…"
          selects={[
            {
              id: "filter-role",
              label: "Role",
              value: "all",
              options: [
                { value: "all", label: "All roles" },
                { value: "ADMIN", label: "Administrator" },
                { value: "TEACHER", label: "Teacher" },
                { value: "STUDENT", label: "Student" },
              ],
            },
            {
              id: "filter-state",
              label: "State",
              value: "all",
              options: [
                { value: "all", label: "All states" },
                { value: "active", label: "Active" },
                { value: "pending", label: "Pending activation" },
                { value: "archived", label: "Archived" },
              ],
            },
          ]}
          resultCount={MOCK_ADMIN_USERS.length}
          resultNoun="account"
        />

        <SectionCard title="Accounts" description="Every account known to the institution.">
          <DataTable
            caption="Accounts"
            columns={columns}
            rows={MOCK_ADMIN_USERS}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Button type="button" variant="ghost" size="xs" aria-label={`Manage ${row.name}`}>
                Manage
              </Button>
            )}
            empty={
              <EmptyState
                size="sm"
                title="No accounts match"
                description="Clear the search or choose a different role or state."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
