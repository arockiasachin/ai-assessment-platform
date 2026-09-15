import type { Metadata } from "next"
import { FileDown, Printer, Star } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ANALYTICS_SUMMARY,
  MOCK_ASSESSMENT_BY_ID,
  MOCK_COURSE,
  MOCK_COURSE_RATING_AVERAGE,
  MOCK_COURSE_RATINGS,
  MOCK_MARKS,
  MOCK_STUDENTS,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPoints,
  type CourseRating,
  type Student,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Reports",
}

const HREF = "/mockup/teacher/reports"

const QUIZ_1 = MOCK_ASSESSMENT_BY_ID["asm_quiz1"]
const DESCRIPTIVE = MOCK_ASSESSMENT_BY_ID["asm_descriptive"]

const RATINGS_WITH_COMMENT = MOCK_COURSE_RATINGS.filter((rating) => rating.comment !== null).length
const RATINGS_PURGED = MOCK_COURSE_RATINGS.filter((rating) => rating.purged).length

/** One mark out of a maximum, with an em dash when the mark does not exist. */
function markCell(studentId: string, key: "quiz1" | "descriptive", maxPoints: number) {
  const points = MOCK_MARKS[key][studentId]
  return <span className="font-mono tabular-nums">{formatPoints(points, maxPoints)}</span>
}

/**
 * Reports — printable student and cohort summaries.
 *
 * Two absences are kept distinct on purpose: a student who left no comment and a
 * comment removed by the retention policy are different facts, and the table
 * says which is which.
 */
export default function TeacherReportsPage() {
  const studentColumns: Column<Student>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[16rem] truncate font-medium" title={row.name}>
            {row.name}
          </p>
          <p className="text-xs text-muted-foreground">{row.registerNumber}</p>
        </div>
      ),
    },
    {
      id: "quiz1",
      header: QUIZ_1 ? `Quiz 1 (/${QUIZ_1.maxPoints})` : "Quiz 1",
      align: "right",
      cell: (row) => markCell(row.id, "quiz1", QUIZ_1?.maxPoints ?? 0),
    },
    {
      id: "descriptive",
      header: DESCRIPTIVE ? `Descriptive (/${DESCRIPTIVE.maxPoints})` : "Descriptive",
      align: "right",
      hideBelow: "sm",
      cell: (row) => markCell(row.id, "descriptive", DESCRIPTIVE?.maxPoints ?? 0),
    },
    {
      id: "average",
      header: "Average",
      align: "right",
      cell: (row) =>
        row.avgPercent === null ? (
          <span className="font-mono text-muted-foreground tabular-nums">
            —<span className="sr-only"> no published marks</span>
          </span>
        ) : (
          <span className="font-mono tabular-nums">{formatPercent(row.avgPercent)}</span>
        ),
    },
    {
      id: "submitted",
      header: "Submitted",
      align: "right",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPoints(row.submittedCount, row.submittedCount + row.missingCount)}
        </span>
      ),
    },
    {
      id: "standing",
      header: "Standing",
      cell: (row) =>
        row.atRisk ? (
          <StatusPill status="flagged" label="At risk" dot />
        ) : (
          <StatusPill status="active" label="On track" dot />
        ),
    },
  ]

  const ratingColumns: Column<CourseRating>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <span className="max-w-[16rem] truncate font-medium" title={row.studentName}>
          {row.studentName}
        </span>
      ),
    },
    {
      id: "rating",
      header: "Rating",
      align: "right",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          <Star className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono tabular-nums">{row.rating} / 5</span>
        </span>
      ),
    },
    {
      id: "comment",
      header: "Comment",
      cell: (row) => {
        if (row.purged) {
          return <StatusPill status="archived" label="Removed by retention policy" dot />
        }
        if (row.comment === null) {
          return (
            <span className="text-muted-foreground">
              No comment left
              <span className="sr-only"> — the student gave a rating only</span>
            </span>
          )
        }
        return (
          <span className="block max-w-[34rem] whitespace-normal text-muted-foreground">
            {row.comment}
          </span>
        )
      },
    },
    {
      id: "date",
      header: "Received",
      hideBelow: "sm",
      cell: (row) => <span className="text-muted-foreground">{formatDate(row.createdAt)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Reports"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Reports" },
        ]}
        actions={
          <>
            <Button variant="outline">
              <Printer className="size-4" aria-hidden="true" />
              Print
            </Button>
            <Button>
              <FileDown className="size-4" aria-hidden="true" />
              Download PDF
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Course rating"
            value={`${MOCK_COURSE_RATING_AVERAGE} / 5`}
            hint={`${MOCK_COURSE_RATINGS.length} responses · ${RATINGS_WITH_COMMENT} with a comment`}
            icon={Star}
          />
          <StatCard
            label="Cohort mean"
            value={formatPercent(MOCK_ANALYTICS_SUMMARY.cohortAverage)}
            hint={`${MOCK_ANALYTICS_SUMMARY.publishedCount} students with published marks`}
          />
          <StatCard
            label="Completion"
            value={formatPercent(MOCK_ANALYTICS_SUMMARY.completionPercent)}
            hint="Assessments submitted across the offering"
          />
          <StatCard
            label="At risk"
            value={String(MOCK_ANALYTICS_SUMMARY.atRiskCount)}
            hint="Flagged for intervention"
          />
        </div>

        <SectionCard
          title="Student report cards"
          description={`Per-assessment marks for ${MOCK_STUDENTS.length} students. Averages use published marks only, so an unreleased assessment does not move the number.`}
        >
          <DataTable
            caption="Student report cards"
            columns={studentColumns}
            rows={MOCK_STUDENTS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No students to report on"
                description="Reports are generated from the roster and its published marks."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Course feedback"
          description={`${MOCK_COURSE_RATINGS.length} ratings, newest first. ${RATINGS_PURGED} free-text comment was removed by the retention policy; the numeric rating was kept.`}
        >
          <DataTable
            caption="Course feedback"
            columns={ratingColumns}
            rows={MOCK_COURSE_RATINGS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                title="No feedback yet"
                description="Course ratings appear here once students submit them."
              />
            }
          />
          <p className="mt-3 text-xs text-muted-foreground">
            Latest response received {formatDateTime(MOCK_COURSE_RATINGS[0]?.createdAt)}.
          </p>
        </SectionCard>
      </div>
    </>
  )
}
