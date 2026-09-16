import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { getAdminOfferingsList } from "@/lib/admin-db"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Course Offerings" }

type OfferingRow = Awaited<ReturnType<typeof getAdminOfferingsList>>[number]

/**
 * Column definitions, matching every other table in the app.
 *
 * Two-line cells keep the pairing (name over code) rather than dropping the code — the code is what
 * an admin cross-references elsewhere, so it is small text under the name rather than a column that
 * would be mostly whitespace.
 */
const columns: Column<OfferingRow>[] = [
  {
    id: "course",
    header: "Course",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{row.courseName}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.courseCode}</p>
      </div>
    ),
  },
  {
    id: "class",
    header: "Class",
    hideBelow: "md",
    cell: (row) => (
      <div className="min-w-0">
        <p>{row.className}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.classCode}</p>
      </div>
    ),
  },
  {
    id: "teacher",
    header: "Teacher",
    hideBelow: "sm",
    cell: (row) => (
      <div className="min-w-0">
        <p>{row.teacherName}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.teacherEmpId}</p>
      </div>
    ),
  },
  {
    id: "term",
    header: "Term",
    cell: (row) => (
      <span className="whitespace-nowrap">
        {row.term} {row.academicYear}
      </span>
    ),
  },
  {
    id: "load",
    header: "Load",
    align: "right",
    hideBelow: "md",
    cell: (row) => (
      // "Enrolled of capacity" in one cell: the pair is the fact, and two columns of numbers that
      // only mean something together invite reading one of them alone.
      <span className="font-mono text-xs tabular-nums">
        {row.enrolled} / {row.capacity}
      </span>
    ),
  },
  {
    id: "assessments",
    header: "Assessments",
    align: "right",
    cell: (row) => <span className="font-mono text-xs tabular-nums">{row.assessments}</span>,
  },
]

export default async function AdminOfferingsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

  const offerings = await getAdminOfferingsList()

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
          title="Course Offerings"
          description="Review course/class assignments, teacher ownership, enrollment load, and assessment density."
        />
        <DataTable
          caption="Course offerings"
          columns={columns}
          rows={offerings}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              title="No offerings"
              description="No course offering exists yet, so there is nothing to review."
            />
          }
        />
      </AppShell>
    </RoleGuard>
  )
}
