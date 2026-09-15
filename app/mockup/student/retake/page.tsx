import type { Metadata } from "next"
import { ListChecks, RefreshCw, Target, Trophy, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "../_lib/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_MY_QUIZ_ATTEMPTS,
  MOCK_RETAKE_RECOMMENDATIONS,
  MOCK_TOPIC_MASTERY,
  formatPoints,
  formatPercent,
  type QuizAttemptSummary,
  type RetakeRecommendation,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Retake",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  topics: Target,
  questions: ListChecks,
  best: Trophy,
  attempts: RefreshCw,
}

const RECOMMENDATION_STATE: Record<string, { status: StatusKey; label: string }> = {
  active: { status: "active", label: "Recommended" },
  completed: { status: "completed", label: "Spaced revision" },
  "insufficient-data": { status: "insufficient-data", label: "Needs a baseline" },
}

/** A mastery bar is only drawn when there is enough attempt history to score it. */
function masteryTone(mastery: number): "success" | "primary" {
  return mastery >= 80 ? "success" : "primary"
}

const columns: Column<RetakeRecommendation>[] = [
  {
    id: "topic",
    header: "Topic",
    cell: (row) => <span className="font-medium">{row.topic}</span>,
  },
  {
    id: "mastery",
    header: "Mastery",
    cell: (row) =>
      row.mastery === null ? (
        <StatusPill status="insufficient-data" dot />
      ) : (
        <ProgressBar
          value={row.mastery}
          max={100}
          valueText={`${row.mastery}%`}
          tone={masteryTone(row.mastery)}
          className="w-40"
        />
      ),
  },
  {
    id: "questions",
    header: "Questions",
    align: "right",
    hideBelow: "sm",
    cell: (row) => <span className="font-mono tabular-nums">{row.questions}</span>,
  },
  {
    id: "reason",
    header: "Why this is recommended",
    className: "max-w-96 whitespace-normal",
    cell: (row) => <span className="text-sm text-muted-foreground text-pretty">{row.reason}</span>,
  },
  {
    id: "state",
    header: "State",
    cell: (row) => {
      const meta = RECOMMENDATION_STATE[row.state] ?? RECOMMENDATION_STATE.active
      return <StatusPill status={meta.status} label={meta.label} dot />
    },
  },
]

export default function StudentRetakePage() {
  const recommended = MOCK_RETAKE_RECOMMENDATIONS.filter(
    (recommendation) => recommendation.state === "active",
  )
  const questionsAvailable = recommended.reduce(
    (total, recommendation) => total + recommendation.questions,
    0,
  )
  const gradedAttempts = MOCK_MY_QUIZ_ATTEMPTS.filter(
    (attempt): attempt is QuizAttemptSummary & { score: number } => attempt.score !== null,
  )
  const bestAttempt = gradedAttempts.reduce<(QuizAttemptSummary & { score: number }) | null>(
    (best, attempt) => (best === null || attempt.score > best.score ? attempt : best),
    null,
  )

  const kpis = [
    {
      id: "topics",
      label: "Topics to revise",
      value: String(recommended.length),
      hint: "Built from your weakest subtopics",
    },
    {
      id: "questions",
      label: "Questions available",
      value: String(questionsAvailable),
      hint: "Across the recommended topics",
    },
    {
      id: "best",
      label: "Best quiz score",
      // No graded sitting means no score — never a zero.
      value: bestAttempt === null ? "—" : formatPoints(bestAttempt.score, bestAttempt.maxScore),
      hint:
        bestAttempt === null
          ? "No graded sitting yet"
          : `${formatPercent((bestAttempt.score / bestAttempt.maxScore) * 100)} on ${bestAttempt.assessmentTitle}`,
    },
    {
      id: "attempts",
      label: "Graded attempts used",
      value: String(MOCK_MY_QUIZ_ATTEMPTS.length),
      hint: "Practice retakes do not count towards this",
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Retake" },
        ]}
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Retake"
        description="Adaptive retake practice built from your weakest subtopics."
        actions={<Button type="button">Start retake</Button>}
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              icon={KPI_ICONS[kpi.id]}
            />
          ))}
        </div>

        <SectionCard
          title="Recommended practice"
          description="Generated from the questions you got wrong. A topic with too little attempt history reports insufficient data rather than a made-up score."
          action={<StatusPill status="active" label="Adaptive" />}
        >
          <DataTable
            caption="Recommended retake topics"
            columns={columns}
            rows={MOCK_RETAKE_RECOMMENDATIONS}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Button
                type="button"
                variant={row.state === "active" ? "outline" : "ghost"}
                size="sm"
                disabled={row.state !== "active"}
              >
                {row.state === "active" ? "Practise" : "Unavailable"}
              </Button>
            )}
            empty={
              <EmptyState
                title="Nothing to revise"
                description="You have no weak subtopics on record yet. Finish a graded sitting and recommendations appear here."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title="Topic mastery"
          description="How well each topic is going across your attempts so far."
        >
          {MOCK_TOPIC_MASTERY.length === 0 ? (
            <EmptyState
              title="No topic data yet"
              description="Topic mastery appears once you have answered quiz questions."
            />
          ) : (
            <ul className="space-y-4">
              {MOCK_TOPIC_MASTERY.map((row) => (
                <li key={row.topic}>
                  {row.mastery === null ? (
                    <MetricRow
                      label={row.topic}
                      value={<StatusPill status="insufficient-data" />}
                      hint={`${row.responses} responses — below the reporting threshold`}
                    />
                  ) : (
                    <ProgressBar
                      value={row.mastery}
                      max={100}
                      label={row.topic}
                      valueText={`${row.mastery}%`}
                      tone={masteryTone(row.mastery)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  )
}
