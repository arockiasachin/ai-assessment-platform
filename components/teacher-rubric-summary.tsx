import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import type { RubricResponse, TeacherAssessmentSummary } from "@/lib/rubric-grading/contracts"

/**
 * Read-only view of a rubric, shown beside the editor.
 *
 * The mockup screen is a read-only report while the real page is an authoring
 * form, so this is **additive**: it renders the same data the editor edits, and
 * the editor stays the write path. Replacing the editor with this would have
 * deleted rubric authoring.
 *
 * Weights are rendered as **relative** numbers, with no "totals 100%" claim. The
 * schema fixes no unit for `RubricCriterion.weight` (`Float @default(1)`) and
 * validation only requires a positive finite value, so a validity claim here
 * would assert a rule the backend does not enforce (`docs/plans/wave-1.md` §D8).
 */

function RubricPanel({ assessment }: { assessment: TeacherAssessmentSummary }) {
  const rubric = assessment.rubric
  if (!rubric) return null

  const criteria = [...rubric.criteria].sort((a, b) => a.order - b.order)
  const totalPoints = criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0)
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  const heaviest = criteria.reduce((max, criterion) => Math.max(max, criterion.weight), 0)

  return (
    <SectionCard
      title={rubric.title}
      description={
        rubric.description ??
        `${assessment.courseCode} · ${assessment.className} · marking out of ${assessment.maxMarks}`
      }
      action={
        <StatusPill
          status={criteria.length > 0 ? "active" : "pending"}
          label={`${criteria.length} criterion${criteria.length === 1 ? "" : "a"}`}
          dot
        />
      }
    >
      <div className="space-y-4">
        <div>
          <MetricRow
            label="Sum of criterion ceilings"
            value={`${totalPoints} pts`}
            hint={`Assessment is marked out of ${assessment.maxMarks}`}
          />
          <MetricRow
            label="Model prompt version"
            value={<span className="font-mono text-xs">{rubric.promptVersion}</span>}
            hint="Stored with every suggestion so a decision can be replayed"
          />
          {rubric.maxPoints !== null && (
            <MetricRow label="Rubric ceiling" value={`${rubric.maxPoints} pts`} />
          )}
        </div>

        {criteria.length === 0 ? (
          <EmptyState
            title="No criteria yet"
            description="A rubric needs at least one criterion before the model can score against it."
          />
        ) : (
          <ul className="space-y-3">
            {criteria.map((criterion) => (
              <li key={criterion.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{criterion.label}</p>
                    {criterion.description && (
                      <p className="text-xs text-muted-foreground">{criterion.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    ceiling {criterion.maxPoints} pts
                  </span>
                </div>

                {/*
                 * Relative, not a percentage of a fixed 100. `totalWeight` is 0
                 * only if every weight is zero, which validation rejects, so the
                 * division is safe; the guard is belt-and-braces.
                 */}
                <ProgressBar
                  value={heaviest > 0 ? (criterion.weight / heaviest) * 100 : 0}
                  max={100}
                  label="Relative weight"
                  valueText={`${criterion.weight}`}
                />

                {criterion.levels.length > 0 && (
                  <ul className="space-y-1 border-t border-border pt-2">
                    {criterion.levels.map((level, index) => (
                      <li key={`${criterion.id}-${index}`} className="flex gap-2 text-xs">
                        <span className="w-20 shrink-0 text-muted-foreground">{level.label}</span>
                        <span className="w-14 shrink-0 font-mono tabular-nums">
                          {level.points} pts
                        </span>
                        <span className="min-w-0 text-muted-foreground">{level.descriptor}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        <Callout tone="info" title="How the ceilings are used">
          The model may suggest a score up to each criterion&apos;s ceiling and no higher. Criteria
          carry weights of {totalWeight} in total — treat them as relative: nothing enforces a fixed
          sum.
        </Callout>
      </div>
    </SectionCard>
  )
}

export function TeacherRubricSummary({ assessments }: { assessments: TeacherAssessmentSummary[] }) {
  const withRubric = assessments.filter((assessment) => assessment.rubric !== null)

  if (withRubric.length === 0) {
    return (
      <SectionCard title="Current rubric">
        <EmptyState
          title="No rubric yet"
          description="Pick an assessment and add criteria below. The model scores within each criterion's ceiling."
        />
      </SectionCard>
    )
  }

  return (
    <div className="space-y-6">
      {withRubric.map((assessment) => (
        <RubricPanel key={assessment.id} assessment={assessment} />
      ))}
    </div>
  )
}

/** Re-exported for the page's typing convenience. */
export type { RubricResponse }
