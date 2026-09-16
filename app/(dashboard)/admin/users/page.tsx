import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { getAdminUsersList } from "@/lib/admin-db"
import { getSessionUser } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "User Directory" }

type UserRow = Awaited<ReturnType<typeof getAdminUsersList>>[number]

/**
 * Role → tone, so the directory is scannable by role without reading every cell.
 *
 * The label comes from `roleLabelFromRole` rather than the raw enum: this table previously printed
 * `ADMIN` / `TEACHER` / `STUDENT` straight from the database, which is the raw-enum leak the Wave 1
 * passes removed everywhere else.
 */
const ROLE_TONE: Record<string, StatusKey> = {
  admin: "overridden",
  teacher: "published",
  student: "active",
}

const columns: Column<UserRow>[] = [
  {
    id: "email",
    header: "Email",
    cell: (row) => <span className="font-medium">{row.email}</span>,
  },
  {
    id: "role",
    header: "Role",
    cell: (row) => {
      // `roleLabelFromRole` only upper-cases the first character, so the Prisma enum `"ADMIN"`
      // would render as `"ADMIN"` — the raw enum, which is what this cell is replacing. Lower-cased
      // first, it reads `"Admin"`.
      const label = roleLabelFromRole(row.role.toLowerCase())
      return <StatusPill status={ROLE_TONE[label.toLowerCase()] ?? "active"} label={label} dot />
    },
  },
  {
    id: "name",
    header: "Name",
    hideBelow: "sm",
    cell: (row) =>
      // An em dash, not a sentinel: a user with no profile name is a real absence. The reader
      // returns `null` for it rather than `"-"`, so the absence is distinguishable and the em-dash
      // rule applies.
      row.name === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span>{row.name}</span>
      ),
  },
  {
    id: "identity",
    header: "Identity",
    hideBelow: "md",
    cell: (row) =>
      row.identity === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="font-mono text-xs">{row.identity}</span>
      ),
  },
  {
    id: "created",
    header: "Created",
    align: "right",
    hideBelow: "md",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDateTime(row.createdAt)}</span>
    ),
  },
]

export default async function AdminUsersPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

  const users = await getAdminUsersList()

  return (
    <RoleGuard role="admin">
      <AppShell
        scope="app"
        role="admin"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="User Directory"
          description="Inspect user accounts, role assignments, and identity profile links."
        />
        <DataTable
          caption="User accounts"
          columns={columns}
          rows={users}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              title="No users"
              description="No user account exists yet, so there is nothing to inspect."
            />
          }
        />
      </AppShell>
    </RoleGuard>
  )
}
