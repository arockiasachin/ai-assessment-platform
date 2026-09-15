import type { Metadata } from "next"
import Link from "next/link"
import { BarChart3, TriangleAlert, UserPlus, Users, UsersRound } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { TruncatedText } from "@/components/ui/truncated-text"
import {
  MOCK_COURSE,
  MOCK_GROUPS,
  MOCK_STUDENTS,
  MOCK_UNASSIGNED_STUDENTS,
  formatDateTime,
  formatPercent,
  formatPoints,
  formatRelativeTime,
  type Student,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Classes",
}

const HREF = "/mockup/teacher/classes"

const GROUPS_FORMED = MOCK_GROUPS.filter((group) => group.state !== "FORMING").length
const AT_RISK = MOCK_STUDENTS.filter((student) => student.atRisk).length
const WITHOUT_MARKS = MOCK_STUDENTS.filter((student) => student.avgPercent === null).length

/**
 * Classes — the offering's roster.
 *
 * Three roster states are exercised on purpose: a very long name, a student
 * with no published mark (average `null`, rendered as an em dash), and a late
 * enrolment that has never signed in.
 */
export default function TeacherClassesPage() {
  const columns: Column<Student>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar size="sm" className="shrink-0">
            <AvatarFallback>{row.initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <TruncatedText className="font-medium" title={row.name}>
              {row.name}
            </TruncatedText>
            <p className="truncate text-xs text-muted-foreground">
              {row.registerNumber} · {row.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "group",
      header: "Group",
      hideBelow: "md",
      cell: (row) =>
        row.groupName ?? <span className="text-xs text-muted-foreground">Not placed</span>,
    },
    {
      id: "average",
      header: "Average",
      align: "right",
      cell: (row) =>
        row.avgPercent === null ? (
          <span className="font-mono text-muted-foreground tabular-nums">
            —<span className="sr-only">no published marks yet</span>
          </span>
        ) : (
          <span className="font-mono tabular-nums">{formatPercent(row.avgPercent)}</span>
        ),
    },
    {
      id: "submitted",
      header: "Submitted",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPoints(row.submittedCount, row.submittedCount + row.missingCount)}
        </span>
      ),
    },
    {
      id: "active",
      header: "Last active",
      hideBelow: "lg",
      cell: (row) =>
        row.lastActiveAt === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only">never signed in</span>
          </span>
        ) : (
          <span className="text-muted-foreground" title={formatDateTime(row.lastActiveAt)}>
            {formatRelativeTime(row.lastActiveAt)}
          </span>
        ),
    },
    {
      id: "risk",
      header: "Standing",
      cell: (row) =>
        row.atRisk ? (
          <StatusPill status="flagged" label="At risk" dot />
        ) : (
          <StatusPill status="active" label="On track" dot />
        ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.term} · ${MOCK_COURSE.section}`}
        title="Classes"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Classes" },
        ]}
        actions={
          <>
            <Button variant="outline">
              <UsersRound className="size-4" aria-hidden="true" />
              Message class
            </Button>
            <Button>
              <UserPlus className="size-4" aria-hidden="true" />
              Add student
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Enrolled"
            value={String(MOCK_COURSE.studentCount)}
            hint={`${MOCK_COURSE.code} · ${MOCK_COURSE.section}`}
            icon={Users}
          />
          <StatCard
            label="At risk"
            value={String(AT_RISK)}
            hint="Below 60%, or no work submitted"
            icon={TriangleAlert}
          />
          <StatCard
            label="Groups formed"
            value={`${GROUPS_FORMED} of ${MOCK_GROUPS.length}`}
            hint={`${MOCK_UNASSIGNED_STUDENTS.length} ${
              MOCK_UNASSIGNED_STUDENTS.length === 1 ? "student" : "students"
            } not placed in a team`}
            icon={UsersRound}
          />
          <StatCard
            label="Course completion"
            value={formatPercent(MOCK_COURSE.completionPercent)}
            hint={`Cohort mean ${formatPercent(MOCK_COURSE.avgPercent)} on published work`}
            icon={BarChart3}
          />
        </div>

        <FilterBar
          searchLabel="Search roster"
          searchPlaceholder="Search name, register number or email…"
          resultCount={MOCK_STUDENTS.length}
          resultNoun="student"
          selects={[
            {
              id: "filter-group",
              label: "Group",
              value: "all",
              options: [
                { value: "all", label: "All groups" },
                ...MOCK_GROUPS.map((group) => ({ value: group.id, label: group.name })),
                { value: "unassigned", label: "Not placed" },
              ],
            },
            {
              id: "filter-standing",
              label: "Performance",
              value: "all",
              options: [
                { value: "all", label: "All students" },
                { value: "at-risk", label: "At risk" },
                { value: "on-track", label: "On track" },
                { value: "no-marks", label: `No published marks (${WITHOUT_MARKS})` },
                { value: "long-name", label: "Longest name" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Roster"
          description={`${MOCK_STUDENTS.length} students on ${MOCK_COURSE.code} · ${MOCK_COURSE.section}. Averages use published marks only.`}
          action={
            <Link
              href="/mockup/teacher/groups"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <UsersRound className="size-3.5" aria-hidden="true" />
              Group students
            </Link>
          }
        >
          <DataTable
            caption="Class roster"
            columns={columns}
            rows={MOCK_STUDENTS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                icon={Users}
                title="No students enrolled"
                description="Once students are enrolled they appear here with their published average."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
