import Link from "next/link"

import { formatDate } from "@/lib/format"
import {
  ArrowRight,
  CalendarClock,
  FolderKanban,
  GraduationCap,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react"
import { RoleGuard } from "@/components/role-guard"
import { redirect } from "next/navigation"

import { AppShell, PageHeader } from "@/components/shell"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getAdminOverview } from "@/lib/admin-db"

// Authenticated, database-backed dashboard: never statically prerender.
export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "admin") redirect("/login")

  const overview = await getAdminOverview()

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
          title="Overview"
          description="Monitor users, academics, and operations across the platform."
        />
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Total users</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="inline-flex items-center gap-2 text-2xl font-semibold">
                  <Users className="size-5 text-primary" />
                  {overview.totals.users}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Offerings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="inline-flex items-center gap-2 text-2xl font-semibold">
                  <GraduationCap className="size-5 text-primary" />
                  {overview.totals.offerings}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Assessments</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="inline-flex items-center gap-2 text-2xl font-semibold">
                  <FolderKanban className="size-5 text-primary" />
                  {overview.totals.assessments}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Upcoming events</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="inline-flex items-center gap-2 text-2xl font-semibold">
                  <CalendarClock className="size-5 text-primary" />
                  {overview.totals.upcomingEvents}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Role distribution</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-primary" />
                    Admins
                  </span>
                  <span className="font-semibold">{overview.roleCounts.admin}</span>
                </p>
                <p className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <UserCog className="size-4 text-primary" />
                    Teachers
                  </span>
                  <span className="font-semibold">{overview.roleCounts.teacher}</span>
                </p>
                <p className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-4 text-primary" />
                    Students
                  </span>
                  <span className="font-semibold">{overview.roleCounts.student}</span>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick routes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  { href: "/admin/users", label: "Manage users" },
                  { href: "/admin/offerings", label: "Review offerings" },
                  { href: "/admin/data", label: "Open data explorer" },
                  { href: "/admin/tools", label: "Run admin tools" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <span>{item.label}</span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent assessments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {overview.recentAssessments.map((assessment) => (
                  <div
                    key={assessment.id}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <p className="font-medium">{assessment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {assessment.courseName} · {assessment.type} · {formatDate(assessment.dueDate)}{" "}
                      · {assessment.teacherName}
                    </p>
                  </div>
                ))}
                {overview.recentAssessments.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recent assessments found.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </RoleGuard>
  )
}
