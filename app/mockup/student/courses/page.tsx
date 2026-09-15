import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { GradeDonut, type GradeDonutSlice } from "@/components/ui/grade-donut"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_COURSE_RATING_AVERAGE,
  MOCK_COURSE_RATINGS,
  MOCK_MATERIALS_SUMMARY,
  formatDate,
  type CourseRating,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Courses",
}

const STARS = [5, 4, 3, 2, 1] as const

const ratingSlices: GradeDonutSlice[] = STARS.map((star) => ({
  id: `stars-${star}`,
  label: star === 1 ? "1 star" : `${star} stars`,
  value: MOCK_COURSE_RATINGS.filter((rating) => rating.rating === star).length,
})).filter((slice) => slice.value > 0)

function CommentCell({ row }: { row: CourseRating }) {
  if (row.purged) {
    return <span className="text-xs text-muted-foreground">Removed by the retention policy</span>
  }
  if (row.comment === null) {
    return <span className="text-xs text-muted-foreground">No comment left</span>
  }
  return <span className="text-xs text-muted-foreground text-pretty">{row.comment}</span>
}

const ratingColumns: Column<CourseRating>[] = [
  {
    id: "student",
    header: "Student",
    cell: (row) => <span className="font-medium">{row.studentName}</span>,
  },
  {
    id: "rating",
    header: "Rating",
    cell: (row) => (
      <span className="font-mono tabular-nums">
        {row.rating} / 5<span className="sr-only"> stars</span>
      </span>
    ),
  },
  {
    id: "comment",
    header: "Comment",
    className: "max-w-96 whitespace-normal",
    cell: (row) => <CommentCell row={row} />,
  },
  {
    id: "created",
    header: "Submitted",
    align: "right",
    hideBelow: "sm",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{formatDate(row.createdAt)}</span>
    ),
  },
]

export default function StudentCoursesPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Courses" },
        ]}
        eyebrow={MOCK_COURSE.term}
        title="Courses"
        description="Enrolled courses, materials, and course ratings."
        actions={
          <Link href="/mockup/student/resources" className={buttonVariants({ variant: "outline" })}>
            Open resources
          </Link>
        }
      />

      <div className="space-y-6">
        <SectionCard
          title={MOCK_COURSE.name}
          description={MOCK_COURSE.description}
          action={<StatusPill status="active" label={MOCK_COURSE.section} />}
        >
          <div className="space-y-4">
            <KeyValueList
              items={[
                {
                  label: "Course code",
                  value: <span className="font-mono">{MOCK_COURSE.code}</span>,
                },
                { label: "Teacher", value: MOCK_COURSE.teacherName },
                { label: "Room", value: MOCK_COURSE.room },
                { label: "Term", value: `${MOCK_COURSE.term} · ${MOCK_COURSE.section}` },
                { label: "Credits", value: `${MOCK_COURSE.credits} credits` },
                {
                  label: "Cohort",
                  value: `${MOCK_COURSE.studentCount} students`,
                  hint: `${MOCK_COURSE.atRiskCount} flagged at risk`,
                },
                {
                  label: "Runs",
                  value: (
                    <span className="font-mono text-xs tabular-nums">
                      {formatDate(MOCK_COURSE.startsOn)} → {formatDate(MOCK_COURSE.endsOn)}
                    </span>
                  ),
                },
              ]}
            />
            <ProgressBar
              value={MOCK_COURSE.completionPercent}
              label="Course completion"
              tone={MOCK_COURSE.completionPercent >= 70 ? "success" : "primary"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Materials"
          description="Everything on the course reading list, and how much of it the retrieval index has processed."
          action={
            <Link href="/mockup/student/resources" className={buttonVariants({ variant: "link" })}>
              Browse materials
            </Link>
          }
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-0.5">
              <MetricRow
                label="Total materials"
                value={
                  <span className="font-mono tabular-nums">{MOCK_MATERIALS_SUMMARY.total}</span>
                }
              />
              <MetricRow
                label="Indexed for search"
                value={
                  <span className="font-mono tabular-nums">{MOCK_MATERIALS_SUMMARY.indexed}</span>
                }
              />
              <MetricRow
                label="Retrieval chunks"
                value={
                  <span className="font-mono tabular-nums">{MOCK_MATERIALS_SUMMARY.chunks}</span>
                }
                hint="Used by quiz generation and search"
              />
            </div>
            <div className="space-y-0.5">
              <MetricRow
                label="Pending indexing"
                value={
                  MOCK_MATERIALS_SUMMARY.pending === 0 ? (
                    <StatusPill status="completed" label="All indexed" />
                  ) : (
                    <StatusPill
                      status="pending"
                      label={`${MOCK_MATERIALS_SUMMARY.pending} waiting`}
                    />
                  )
                }
                hint="Not searchable until the index catches up"
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Course ratings"
          description="Anonymous feedback left by students on this offering. Ratings stay even when a written comment is removed by the retention policy."
        >
          <div className="space-y-6">
            {ratingSlices.length === 0 ? (
              <EmptyState
                title="No ratings yet"
                description="Nobody has rated this course so far this term."
              />
            ) : (
              <GradeDonut
                slices={ratingSlices}
                centerValue={`${MOCK_COURSE_RATING_AVERAGE} / 5`}
                centerLabel="average"
                label="Distribution of course ratings from 1 to 5 stars"
              />
            )}
            <DataTable
              caption="Course ratings left by students"
              columns={ratingColumns}
              rows={MOCK_COURSE_RATINGS}
              getRowId={(row) => row.id}
              empty={
                <EmptyState
                  size="sm"
                  title="No ratings yet"
                  description="Ratings appear here once students submit their course feedback."
                />
              }
            />
          </div>
        </SectionCard>
      </div>
    </>
  )
}
