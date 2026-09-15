import type { Metadata } from "next"
import { ListChecks, ShieldCheck } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_COURSE,
  MOCK_GRADE_SUGGESTIONS,
  MOCK_RUBRIC,
  formatConfidence,
  formatDateTime,
  formatPoints,
  trimNumber,
} from "@/lib/mock"

import { AUTO_ACCEPT_CONFIDENCE_FLOOR } from "../_lib/labels"
import { ProgressBar } from "@/components/ui/progress-bar"

export const metadata: Metadata = {
  title: "Rubrics",
}

const HREF = "/mockup/teacher/rubrics"

const BOUND_ASSESSMENTS = MOCK_ASSESSMENTS.filter(
  (assessment) => assessment.rubricId === MOCK_RUBRIC.id,
)

const WEIGHT_SUM = MOCK_RUBRIC.criteria.reduce((total, criterion) => total + criterion.weight, 0)
const POINT_SUM = MOCK_RUBRIC.criteria.reduce((total, criterion) => total + criterion.maxPoints, 0)

/** The model's prompt lineage, read from a recorded suggestion rather than retyped. */
const SAMPLE_SUGGESTION = MOCK_GRADE_SUGGESTIONS[0]
const WITHIN_CEILINGS = MOCK_GRADE_SUGGESTIONS.filter(
  (suggestion) => suggestion.suggestedPoints <= suggestion.maxPoints,
).length

const weightValid = Math.abs(WEIGHT_SUM - MOCK_RUBRIC.totalWeight) < 0.0001
const pointsValid = Math.abs(POINT_SUM - MOCK_RUBRIC.maxPoints) < 0.0001

/**
 * Rubrics — the grading contract.
 *
 * The page exists to make one guarantee auditable: the criteria's weights and
 * point ceilings are fixed here, and the model can only suggest a score inside a
 * criterion's ceiling. Nothing on this page can imply otherwise.
 */
export default function TeacherRubricsPage() {
  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · grading contract`}
        title="Rubrics"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Rubrics" },
        ]}
        actions={
          <Button>
            <ListChecks className="size-4" aria-hidden="true" />
            New rubric
          </Button>
        }
      />

      <div className="space-y-6">
        <SectionCard
          title="Rubric"
          description="Metadata and provenance. The prompt version is stored with every grade so any decision can be replayed."
          action={<StatusPill status="active" label="Active" dot />}
        >
          <KeyValueList
            items={[
              { id: "title", label: "Title", value: MOCK_RUBRIC.title },
              { id: "description", label: "Description", value: MOCK_RUBRIC.description },
              {
                id: "course",
                label: "Course",
                value: `${MOCK_COURSE.code} · ${MOCK_COURSE.section}`,
              },
              {
                id: "ceiling",
                label: "Ceiling",
                value: (
                  <span className="font-mono tabular-nums">{MOCK_RUBRIC.maxPoints} points</span>
                ),
                hint: "The most any submission can score on this task",
              },
              {
                id: "weight",
                label: "Total weight",
                value: (
                  <span className="font-mono tabular-nums">
                    {formatConfidence(MOCK_RUBRIC.totalWeight)}
                  </span>
                ),
              },
              {
                id: "criteria",
                label: "Criteria",
                value: `${MOCK_RUBRIC.criteria.length}`,
              },
              {
                id: "bound",
                label: "Bound assessment",
                value:
                  BOUND_ASSESSMENTS.length === 0 ? (
                    "— Not bound to an assessment"
                  ) : (
                    <ul className="space-y-1">
                      {BOUND_ASSESSMENTS.map((assessment) => (
                        <li key={assessment.id}>
                          {assessment.title}{" "}
                          <span className="text-muted-foreground">
                            ({formatPoints(assessment.gradedCount, assessment.expectedCount)}{" "}
                            marked)
                          </span>
                        </li>
                      ))}
                    </ul>
                  ),
                hint: "Changing this rubric changes how that task is graded",
              },
              {
                id: "model",
                label: "Grader",
                value: (
                  <span className="font-mono text-xs">
                    {SAMPLE_SUGGESTION?.model ?? "—"} · {SAMPLE_SUGGESTION?.promptVersion ?? "—"}
                  </span>
                ),
                hint: `Suggestions below ${formatConfidence(
                  AUTO_ACCEPT_CONFIDENCE_FLOOR,
                )} confidence always wait for a teacher`,
              },
              {
                id: "updated",
                label: "Last updated",
                value: formatDateTime(MOCK_RUBRIC.updatedAt),
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Criteria"
          description="Each criterion carries its weight and a point ceiling. The model suggests a score inside that ceiling; it can never exceed it."
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  Weights total{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatConfidence(WEIGHT_SUM)}
                  </span>{" "}
                  of {formatConfidence(MOCK_RUBRIC.totalWeight)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Ceilings total{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {trimNumber(POINT_SUM)}
                  </span>{" "}
                  of {MOCK_RUBRIC.maxPoints} pts
                </span>
                <span className="text-xs text-muted-foreground">
                  {WITHIN_CEILINGS} of {MOCK_GRADE_SUGGESTIONS.length} recorded suggestions are
                  inside their ceiling
                </span>
              </div>
              {weightValid && pointsValid ? (
                <StatusPill status="completed" label="Weights valid" dot />
              ) : (
                <StatusPill status="needs-review" label="Weights must total 100%" dot />
              )}
            </div>
          }
        >
          {MOCK_RUBRIC.criteria.length === 0 ? (
            <EmptyState
              title="This rubric has no criteria"
              description="A rubric needs at least one criterion before it can grade anything."
              action={<Button>Add criterion</Button>}
            />
          ) : (
            <ul className="space-y-6">
              {MOCK_RUBRIC.criteria.map((criterion) => (
                <li key={criterion.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">
                        {criterion.order}. {criterion.label}
                      </h3>
                      <p className="text-sm text-muted-foreground text-pretty">
                        {criterion.description}
                      </p>
                    </div>
                    <StatusPill
                      status="active"
                      label={`${trimNumber(criterion.maxPoints)} pts ceiling`}
                    />
                  </div>

                  <ProgressBar
                    value={criterion.weight * 100}
                    max={100}
                    label={`Weight towards the final mark — ${criterion.label}`}
                    valueText={formatConfidence(criterion.weight)}
                  />

                  <div className="rounded-lg border border-border">
                    <h4 className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      Performance levels
                    </h4>
                    <ul className="divide-y divide-border">
                      {criterion.levels.map((level) => (
                        <li
                          key={level.label}
                          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{level.label}</p>
                            <p className="text-xs text-muted-foreground text-pretty">
                              {level.description}
                            </p>
                          </div>
                          <span className="font-mono text-sm tabular-nums">
                            {trimNumber(level.points)} pts
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="How the model is constrained"
          description="The guard rails a reviewer can rely on when accepting a suggestion."
        >
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
              Suggestions are capped, never scaled.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every criterion has a fixed ceiling. The model proposes a value inside it, and a
              teacher accepts or overrides that value before anything is published — the ceiling
              itself cannot be raised by a suggestion.
            </p>
          </div>
          <div className="mt-2">
            <MetricRow
              label="Auto-accept floor"
              value={formatConfidence(AUTO_ACCEPT_CONFIDENCE_FLOOR)}
              hint="Suggestions at or above this confidence are provisionally accepted, then spot-checked"
            />
            <MetricRow
              label="Rubric ceiling"
              value={`${MOCK_RUBRIC.maxPoints} pts`}
              hint="Matches the max points of the bound assessment"
            />
            <MetricRow
              label="Suggested points recorded"
              value={String(MOCK_GRADE_SUGGESTIONS.length)}
              hint="One per criterion per reviewed submission"
            />
          </div>
        </SectionCard>
      </div>
    </>
  )
}
