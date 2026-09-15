import type { Metadata } from "next"
import { BarChart3, Download, TriangleAlert, Users } from "lucide-react"

import { TrendChart } from "@/components/charts"
import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { GradeDonut, type GradeDonutSlice } from "@/components/ui/grade-donut"
import { SectionCard } from "@/components/ui/section-card"
import { Sparkline } from "@/components/ui/sparkline"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ANALYTICS_SUMMARY,
  MOCK_AT_RISK_STUDENTS,
  MOCK_COURSE,
  MOCK_GRADE_DISTRIBUTION,
  MOCK_ITEM_ANALYSIS,
  MOCK_SCORE_TREND,
  MOCK_SPARKLINES,
  MOCK_TOPIC_MASTERY,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  type ItemAnalysis,
  type Student,
} from "@/lib/mock"
import { TeacherProgress } from "../_lib/teacher-progress"

export const metadata: Metadata = {
  title: "Analytics",
}

const HREF = "/mockup/teacher/analytics"

/**
 * GradeDonut chart keys become CSS custom properties, so the ids must be
 * CSS-safe — the human-readable bucket stays in `label`.
 */
const DONUT_IDS = ["bucket90", "bucket80", "bucket70", "bucket60", "bucketBelow"]

const DISTRIBUTION: GradeDonutSlice[] = MOCK_GRADE_DISTRIBUTION.map((bucket, index) => ({
  id: DONUT_IDS[index] ?? `bucket${index}`,
  label: bucket.bucket,
  value: bucket.count,
}))

/**
 * Analytics — cohort performance, question quality and who needs help.
 *
 * The page never turns an absent measurement into a zero: a question with too
 * few responses reports insufficient data, and a topic with no responses gets a
 * status pill instead of a 0% bar.
 */
export default function TeacherAnalyticsPage() {
  const itemColumns: Column<ItemAnalysis>[] = [
    {
      id: "question",
      header: "Question",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[24rem] truncate font-medium" title={row.prompt}>
            {row.order}. {row.prompt}
          </p>
          <p className="text-xs text-muted-foreground">{row.topic}</p>
        </div>
      ),
    },
    {
      id: "responses",
      header: "Responses",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.responses}</span>,
    },
    {
      id: "correct",
      header: "Answered correctly",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPercent(row.percentCorrect === null ? null : row.percentCorrect * 100)}
        </span>
      ),
    },
    {
      id: "discrimination",
      header: "Discrimination",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.discrimination === null ? "—" : row.discrimination.toFixed(2)}
        </span>
      ),
    },
    {
      id: "flag",
      header: "Quality",
      cell: (row) => <StatusPill status={row.flag} dot />,
    },
    {
      id: "note",
      header: "Note",
      hideBelow: "lg",
      cell: (row) => (
        <span className="block max-w-[24rem] whitespace-normal text-xs text-muted-foreground">
          {row.note}
        </span>
      ),
    },
  ]

  const riskColumns: Column<Student>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <p className="max-w-[18rem] truncate font-medium" title={row.name}>
            {row.name}
          </p>
          <p className="text-xs text-muted-foreground">{row.groupName ?? "Not in a team"}</p>
        </div>
      ),
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
      id: "missing",
      header: "Missing work",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.missingCount}</span>,
    },
    {
      id: "activity",
      header: "Last active",
      hideBelow: "md",
      cell: (row) =>
        row.lastActiveAt === null ? (
          <span className="text-muted-foreground">
            —<span className="sr-only"> never signed in</span>
          </span>
        ) : (
          <span className="text-muted-foreground" title={formatDateTime(row.lastActiveAt)}>
            {formatRelativeTime(row.lastActiveAt)}
          </span>
        ),
    },
    {
      id: "signal",
      header: "Signal",
      cell: (row) => (
        <StatusPill
          status="flagged"
          label={row.avgPercent === null ? "No work seen" : "Low marks"}
          dot
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · cohort analytics`}
        title="Analytics"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Analytics" },
        ]}
        actions={
          <>
            <Button variant="outline">Analytics settings</Button>
            <Button>
              <Download className="size-4" aria-hidden="true" />
              Export CSV
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Cohort mean"
            value={formatPercent(MOCK_ANALYTICS_SUMMARY.cohortAverage)}
            hint={`${MOCK_ANALYTICS_SUMMARY.publishedCount} students with published marks`}
            icon={BarChart3}
            sparkline={
              <Sparkline
                data={MOCK_SPARKLINES.cohort}
                label="Cohort average over the last six teaching weeks"
              />
            }
          />
          <StatCard
            label="Median"
            value={formatPercent(MOCK_ANALYTICS_SUMMARY.medianPercent)}
            hint="Less sensitive to a single weak script than the mean"
          />
          <StatCard
            label="Completion"
            value={formatPercent(MOCK_ANALYTICS_SUMMARY.completionPercent)}
            hint="Assessments submitted across the offering"
          />
          <StatCard
            label="At risk"
            value={String(MOCK_ANALYTICS_SUMMARY.atRiskCount)}
            hint="Below 60%, or no work submitted"
            icon={TriangleAlert}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Grade distribution"
            description={`Published Quiz 1 marks for ${MOCK_ANALYTICS_SUMMARY.publishedCount} students.`}
          >
            <GradeDonut
              slices={DISTRIBUTION}
              centerValue={formatPercent(MOCK_ANALYTICS_SUMMARY.cohortAverage)}
              centerLabel="cohort mean"
              label="Grade distribution by band"
            />
          </SectionCard>

          <SectionCard
            title="Score trend"
            description="Cohort mean per teaching week against the term target. Week 3 has no assessed work, so it is left empty rather than plotted as zero."
          >
            <TrendChart
              showAverage
              data={MOCK_SCORE_TREND.map((point) => ({
                label: point.period,
                value: point.value,
                average: point.average,
              }))}
            />
          </SectionCard>
        </div>

        <SectionCard
          title="Question quality"
          description="Facility and discrimination per question. Two questions report insufficient data — no number is invented for them."
        >
          <DataTable
            caption="Question quality"
            columns={itemColumns}
            rows={MOCK_ITEM_ANALYSIS}
            getRowId={(row) => row.questionId}
            empty={
              <EmptyState
                title="No item analysis yet"
                description="Publish and run a quiz to collect response statistics."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Topic mastery"
          description="Cohort mastery per topic. A topic with too few responses shows insufficient data instead of a misleading bar."
        >
          <ul className="space-y-4">
            {MOCK_TOPIC_MASTERY.map((topic) => (
              <li key={topic.topic}>
                {topic.mastery === null ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{topic.topic}</p>
                      <p className="text-xs text-muted-foreground">
                        {topic.responses} {topic.responses === 1 ? "response" : "responses"} — below
                        the reporting threshold
                      </p>
                    </div>
                    <StatusPill status="insufficient-data" dot />
                  </div>
                ) : (
                  <TeacherProgress
                    value={topic.mastery}
                    max={100}
                    label={`${topic.topic} — mastery across ${topic.responses} responses`}
                    valueText={formatPercent(topic.mastery)}
                    tone={
                      topic.mastery >= 80 ? "success" : topic.mastery >= 60 ? "primary" : "warning"
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="At risk"
          description={`${MOCK_AT_RISK_STUDENTS.length} students need an intervention. Reaching out is a teacher action — the platform only surfaces the signal.`}
          action={<Users className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <DataTable
            caption="Students at risk"
            columns={riskColumns}
            rows={MOCK_AT_RISK_STUDENTS}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Button
                variant="outline"
                size="xs"
                aria-label={`Record an intervention for ${row.name}`}
              >
                Record intervention
              </Button>
            )}
            empty={
              <EmptyState
                title="Nobody is at risk"
                description="Every student is above the threshold on published work."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}
