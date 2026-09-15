import type { Metadata } from "next"
import Link from "next/link"
import {
  CheckCheck,
  ClipboardCheck,
  FileWarning,
  Quote,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { findNavItem } from "@/components/shell/nav-config"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_GRADE_SUGGESTIONS,
  MOCK_REVIEW_QUEUE,
  MOCK_REVIEW_SUMMARY,
  MOCK_RUBRIC,
  formatConfidence,
  formatDateTime,
  formatPoints,
  formatRelativeTime,
  type GradeSuggestion,
  type ReviewQueueItem,
} from "@/lib/mock"

import {
  AUTO_ACCEPT_CONFIDENCE_FLOOR,
  PRIORITY_LABEL,
  REVIEW_STATE_LABEL,
  REVIEW_STATE_TO_STATUS,
  priorityToStatus,
} from "../_lib/labels"
import { ProgressBar } from "@/components/ui/progress-bar"

export const metadata: Metadata = {
  title: "Reviews",
}

const HREF = "/mockup/teacher/reviews"

/** The auto-accept threshold the model cleared these criteria against. */
const FLOOR = AUTO_ACCEPT_CONFIDENCE_FLOOR

const CRITERIA_AUTO_ACCEPTED = MOCK_GRADE_SUGGESTIONS.filter(
  (suggestion) => suggestion.state === "AUTO_ACCEPTED",
).length

const PROJECT_LABEL: Record<ReviewQueueItem["kind"], string> = {
  QUIZ: "Quiz",
  DESCRIPTIVE: "Descriptive",
  CODE: "Code task",
  GROUP_PROJECT: "Group project",
  ASSIGNMENT: "Assignment",
}

/**
 * The AI grade review queue.
 *
 * This is the page the product's promise rests on, so the screen is explicit
 * about the one invariant that matters: the model produces *suggestions* with a
 * rationale, quoted evidence and a confidence, and a human accepts or overrides
 * each one. Nothing is released to a student by the model.
 *
 * The detail panel follows `?student=<id>` so a reviewer can move from the queue
 * to a specific script without any client-side state — the page stays a Server
 * Component and clicks stay real links.
 */
export default async function TeacherReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const requested = Array.isArray(params.student) ? params.student[0] : params.student

  /**
   * A row's "Review" link always wins, even when the item has no criteria — that
   * is exactly the case the detail panel has to explain. Without a selection the
   * panel opens on the highest-priority open item.
   */
  const selected =
    MOCK_REVIEW_QUEUE.find((item) => item.studentId === requested) ??
    MOCK_REVIEW_QUEUE.find((item) => item.state === "NEEDS_REVIEW" && item.criteria.length > 1) ??
    MOCK_REVIEW_QUEUE[0]

  const previousCase = MOCK_REVIEW_QUEUE.find((item) => item.kind === "CODE")
  /** The item that carries a teacher's override and the reason for it. */
  const overrideCase = MOCK_REVIEW_QUEUE.find((item) =>
    item.criteria.some((criterion) => criterion.overrideReason !== undefined),
  )
  const unscored = MOCK_REVIEW_QUEUE.filter((item) => item.criteria.length === 0)

  const belowFloorCount = selected.criteria.filter(
    (criterion) => criterion.confidence < FLOOR,
  ).length
  const allProvisionallyAccepted =
    selected.criteria.length > 0 &&
    selected.criteria.every((criterion) => criterion.state === "AUTO_ACCEPTED")

  const columns: Column<ReviewQueueItem>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={row.studentName}>
            {row.studentName}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.groupName ?? "No group"} · {PROJECT_LABEL[row.kind]}
          </p>
        </div>
      ),
    },
    {
      id: "assessment",
      header: "Assessment",
      hideBelow: "lg",
      cell: (row) => <span className="text-muted-foreground">{row.assessmentTitle}</span>,
    },
    {
      id: "submitted",
      header: "Submitted",
      hideBelow: "md",
      cell: (row) =>
        row.submittedAt === null ? (
          <StatusPill status="rejected" label="Never submitted" />
        ) : (
          <span className="text-xs text-muted-foreground" title={formatDateTime(row.submittedAt)}>
            {formatRelativeTime(row.submittedAt)}
          </span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => (
        <StatusPill
          status={REVIEW_STATE_TO_STATUS[row.state]}
          label={REVIEW_STATE_LABEL[row.state]}
          dot
        />
      ),
    },
    {
      id: "suggested",
      header: "AI total",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPoints(row.suggestedPoints, row.maxPoints)}
        </span>
      ),
    },
    {
      id: "confidence",
      header: "Confidence",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.confidence < FLOOR && <StatusPill status="needs-review" label="Low" />}
          <span className="font-mono tabular-nums">{formatConfidence(row.confidence)}</span>
        </span>
      ),
    },
    {
      id: "flags",
      header: "Flags",
      hideBelow: "lg",
      cell: (row) =>
        row.flags.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-xs text-muted-foreground">{row.flags.join(" · ")}</span>
        ),
    },
    {
      id: "priority",
      header: "Priority",
      hideBelow: "lg",
      cell: (row) => (
        <StatusPill status={priorityToStatus(row.priority)} label={PRIORITY_LABEL[row.priority]} />
      ),
    },
    {
      id: "reviewer",
      header: "Reviewer",
      hideBelow: "lg",
      cell: (row) =>
        row.reviewer ?? <span className="text-xs text-muted-foreground">Unassigned</span>,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_REVIEW_SUMMARY.assessmentTitle} · ${MOCK_RUBRIC.title}`}
        title="Reviews"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Reviews" },
        ]}
        actions={
          <>
            <StatusPill status="needs-review" label="Assessment not published" dot />
            <Button variant="outline">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              Reassign queue
            </Button>
            <Button>
              <CheckCheck className="size-4" aria-hidden="true" />
              Publish results
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {/* The product rule, stated where a reviewer cannot miss it. */}
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            AI suggests. A teacher approves. Nothing publishes without a human.
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Every score below is a proposal carrying its rationale, the quoted evidence it was drawn
            from, and the model&apos;s confidence. Confirming or overriding a suggestion is a
            separate decision from publishing the assessment, and every override is stored with its
            reason as calibration data.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Pending"
            value={String(MOCK_REVIEW_SUMMARY.pending)}
            hint="Queued, not yet opened"
            icon={ClipboardCheck}
          />
          <StatCard
            label="Needs review"
            value={String(MOCK_REVIEW_SUMMARY.needsReview)}
            hint="Below the auto-accept floor, or flagged"
            icon={TriangleAlert}
          />
          <StatCard
            label="Auto-accepted"
            value={String(MOCK_REVIEW_SUMMARY.autoAccepted)}
            hint={`${CRITERIA_AUTO_ACCEPTED} criteria cleared at ≥ ${formatConfidence(FLOOR)}`}
            icon={Sparkles}
          />
          <StatCard
            label="Overridden"
            value={String(MOCK_REVIEW_SUMMARY.overridden)}
            hint={`${MOCK_REVIEW_SUMMARY.rejected} rejected · reasons kept for calibration`}
            icon={FileWarning}
          />
        </div>

        <FilterBar
          searchLabel="Search by student"
          searchPlaceholder="Search student or register number…"
          resultCount={MOCK_REVIEW_QUEUE.length}
          resultNoun="item in the queue"
          selects={[
            {
              id: "filter-assessment",
              label: "Assessment",
              value: MOCK_REVIEW_SUMMARY.assessmentId,
              options: [
                { value: MOCK_REVIEW_SUMMARY.assessmentId, label: "Descriptive — Modelling" },
                { value: "asm_assignment", label: "Assignment — Inequalities" },
                { value: "asm_code", label: "Code Task — Sorting & Big-O" },
                { value: "all", label: "All assessments" },
              ],
            },
            {
              id: "filter-state",
              label: "Status",
              value: "open",
              options: [
                { value: "open", label: "Open (pending + needs review)" },
                { value: "PENDING", label: "Pending" },
                { value: "NEEDS_REVIEW", label: "Needs review" },
                { value: "OVERRIDDEN", label: "Overridden" },
                { value: "REJECTED", label: "Rejected" },
              ],
            },
            {
              id: "filter-confidence",
              label: "Confidence",
              value: "below-floor",
              options: [
                { value: "below-floor", label: `Below ${formatConfidence(FLOOR)}` },
                { value: "high", label: `At or above ${formatConfidence(FLOOR)}` },
                { value: "any", label: "Any confidence" },
              ],
            },
          ]}
        />

        <SectionCard
          title="Queue"
          description="One row per submission. The model's total is a proposal — the row's state is the human decision so far."
        >
          <DataTable
            caption="AI grade review queue"
            columns={columns}
            rows={MOCK_REVIEW_QUEUE}
            getRowId={(row) => row.id}
            rowActions={(row) => (
              <Link
                href={`${HREF}?student=${row.studentId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
                aria-label={`Open the ${row.assessmentTitle} review for ${row.studentName}`}
              >
                {row.id === selected.id ? "Viewing" : "Review"}
              </Link>
            )}
            empty={
              <EmptyState
                title="Queue is clear"
                description="Every AI suggestion has been accepted, overridden or rejected."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title={`Suggestion detail — ${selected.studentName}`}
          description={`${selected.assessmentTitle} · ${REVIEW_STATE_LABEL[selected.state]} · ${selected.criteria.length} rubric criteria`}
          action={
            <Link
              href={HREF}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              aria-label="Show the highest-priority open item"
            >
              Highest priority
            </Link>
          }
        >
          {selected.criteria.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title="No submission to score"
              description={`${selected.studentName} never submitted this attempt, so there is nothing for the model to grade. The item stays in the queue until the student submits or a teacher marks it missed.`}
              action={<Button variant="outline">Mark as missed</Button>}
            />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                <MetricRow label="Submitted" value={formatDateTime(selected.submittedAt)} />
                <MetricRow
                  label="Reviewer"
                  value={selected.reviewer ?? "Unassigned"}
                  hint={
                    selected.reviewer ? "Owns the final decision" : "Anyone on the teaching team"
                  }
                />
                <MetricRow
                  label="AI total"
                  value={
                    <span className="font-mono">
                      {formatPoints(selected.suggestedPoints, selected.maxPoints)}
                    </span>
                  }
                  hint="Sum of the criterion suggestions below"
                />
                <MetricRow
                  label="Item confidence"
                  value={formatConfidence(selected.confidence)}
                  hint={`Auto-accept floor is ${formatConfidence(FLOOR)}`}
                />
              </div>

              {selected.flags.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 dark:bg-warning/15">
                  <h3 className="text-sm font-semibold text-warning-foreground dark:text-warning">
                    Flags raised on this submission
                  </h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-warning-foreground dark:text-warning">
                    {selected.flags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-border p-3">
                <h3 className="text-sm font-medium">Confirm the model&apos;s work</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {allProvisionallyAccepted
                    ? `All ${selected.criteria.length} criteria cleared the ${formatConfidence(FLOOR)} auto-accept floor and were provisionally accepted. The item is still in the queue for a teacher spot check before the assessment is published.`
                    : belowFloorCount > 0
                      ? `${belowFloorCount} of ${selected.criteria.length} criteria fell below the ${formatConfidence(FLOOR)} confidence floor and need a decision from you before this item can be closed.`
                      : `These criteria cleared the ${formatConfidence(FLOOR)} floor, but the item is still open (${REVIEW_STATE_LABEL[selected.state].toLowerCase()}), so a teacher confirms or overrides each score before the assessment is published.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm">
                    <CheckCheck className="size-4" aria-hidden="true" />
                    Confirm suggestions
                  </Button>
                  <Button variant="outline" size="sm">
                    Override a score
                  </Button>
                  <Button variant="ghost" size="sm">
                    Send back for resubmission
                  </Button>
                </div>
              </div>

              <ul className="grid gap-4 xl:grid-cols-2">
                {selected.criteria.map((criterion) => (
                  <CriterionCard key={criterion.id} criterion={criterion} />
                ))}
              </ul>

              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-sm text-muted-foreground">
                  Accepting every criterion does not release anything: publishing the assessment is
                  a separate action, and the marks stay hidden from students until it is taken.
                </p>
                <Button className="mt-3" variant="outline" size="sm" disabled>
                  Publish results to students
                </Button>
              </div>
            </div>
          )}
        </SectionCard>

        {overrideCase && overrideCase.id !== selected.id && (
          <SectionCard
            title={`Override precedent — ${overrideCase.studentName}`}
            description={`${overrideCase.assessmentTitle} · a teacher changed the model's score and recorded why. Overrides are stored as calibration data.`}
            action={
              <Link
                href={`${HREF}?student=${overrideCase.studentId}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open this item
              </Link>
            }
          >
            <ul className="grid gap-4 xl:grid-cols-2">
              {overrideCase.criteria.map((criterion) => (
                <CriterionCard key={criterion.id} criterion={criterion} />
              ))}
            </ul>
          </SectionCard>
        )}

        {previousCase &&
          previousCase.criteria.length > 0 &&
          previousCase.id !== selected.id &&
          previousCase.studentId !== selected.studentId && (
            <SectionCard
              title={`Low-confidence case — ${previousCase.studentName}`}
              description={`${previousCase.assessmentTitle} · similarity flag needs a verdict before this can be closed`}
              action={
                <Link
                  href={`${HREF}?student=${previousCase.studentId}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open in detail
                </Link>
              }
            >
              <ul className="grid gap-4 xl:grid-cols-2">
                {previousCase.criteria.map((criterion) => (
                  <CriterionCard key={criterion.id} criterion={criterion} />
                ))}
              </ul>
            </SectionCard>
          )}

        <SectionCard
          title="Awaiting a submission"
          description="Queue items with no script to score. They are not deleted — they wait for a decision."
        >
          {unscored.length === 0 ? (
            <EmptyState
              title="Every queue item has a submission"
              description="Nothing is waiting on a student to submit."
            />
          ) : (
            <div className="space-y-4">
              {unscored.map((item) => (
                <EmptyState
                  key={item.id}
                  icon={FileWarning}
                  title={`No submission — ${item.studentName}`}
                  description={`${item.assessmentTitle}. The attempt was opened but never submitted, so no criterion could be scored. ${
                    item.flags.length > 0 ? item.flags.join(" · ") : ""
                  }`}
                  action={<Button variant="outline">Mark as missed</Button>}
                  hint={`Reviewed by ${item.reviewer ?? "nobody yet"}`}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Decision trail"
          description="Every criterion decision, newest first — who or what decided, and on which prompt version."
        >
          <DecisionTrail />
        </SectionCard>
      </div>
    </>
  )
}

/**
 * One criterion's proposal: what the model suggested against the ceiling, why,
 * the evidence it quoted, and the confidence it carried. The accept / override /
 * reject controls sit with the criterion they apply to.
 */
function CriterionCard({ criterion }: { criterion: GradeSuggestion }) {
  const belowFloor = criterion.confidence < FLOOR
  const decided = criterion.state === "AUTO_ACCEPTED" || criterion.state === "OVERRIDDEN"

  return (
    <li className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-balance">{criterion.criterionLabel}</h3>
          <p className="text-xs text-muted-foreground">
            Rubric criterion · ceiling {criterion.maxPoints} pts
          </p>
        </div>
        <StatusPill
          status={REVIEW_STATE_TO_STATUS[criterion.state]}
          label={REVIEW_STATE_LABEL[criterion.state]}
          dot
        />
      </div>

      <div>
        <p className="text-sm">
          AI suggests{" "}
          <span className="font-mono font-medium">
            {formatPoints(criterion.suggestedPoints, criterion.maxPoints)}
          </span>
        </p>
        <ProgressBar
          className="mt-1.5"
          value={criterion.suggestedPoints}
          max={criterion.maxPoints}
          label={`${criterion.criterionLabel} — suggested score`}
          valueText={formatPoints(criterion.suggestedPoints, criterion.maxPoints)}
          tone={belowFloor ? "warning" : "primary"}
        />
      </div>

      <div>
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Why
        </h4>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{criterion.rationale}</p>
      </div>

      <div>
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Quoted evidence
        </h4>
        {criterion.evidence ? (
          <blockquote className="mt-1 flex gap-2 rounded-md bg-muted/60 p-2 text-sm">
            <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 font-mono text-xs text-foreground text-pretty">
              {criterion.evidence}
            </span>
          </blockquote>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            — No quote returned for this criterion.
          </p>
        )}
      </div>

      <div className="border-t border-border pt-1">
        <MetricRow
          label="Confidence"
          value={formatConfidence(criterion.confidence)}
          hint={
            belowFloor
              ? `Below the ${formatConfidence(FLOOR)} auto-accept floor — a teacher must decide`
              : `At or above the ${formatConfidence(FLOOR)} floor`
          }
        />
        <MetricRow
          label="Model"
          value={<span className="font-mono text-xs">{criterion.model}</span>}
        />
        <MetricRow
          label="Prompt version"
          value={<span className="font-mono text-xs">{criterion.promptVersion}</span>}
          hint="Stored with the grade so a decision can be replayed"
        />
        <MetricRow label="Latency" value={`${criterion.latencyMs} ms`} />
        {criterion.decidedBy && (
          <MetricRow
            label="Decided by"
            value={criterion.decidedBy}
            hint={criterion.decidedAt ? formatDateTime(criterion.decidedAt) : undefined}
          />
        )}
        {criterion.finalPoints !== undefined && (
          <MetricRow
            label="Final score"
            value={
              <span className="font-mono">
                {formatPoints(criterion.finalPoints, criterion.maxPoints)}
              </span>
            }
          />
        )}
      </div>

      {criterion.overrideReason && (
        <p className="rounded-md border border-border bg-muted/50 p-2 text-xs text-foreground">
          <span className="font-medium">Override reason:</span> {criterion.overrideReason}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button size="sm" aria-label={`Accept the suggestion for ${criterion.criterionLabel}`}>
          <CheckCheck className="size-3.5" aria-hidden="true" />
          {decided ? "Confirm" : "Accept"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Override the score for ${criterion.criterionLabel}`}
        >
          Override
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Reject the suggestion for ${criterion.criterionLabel}`}
        >
          Reject
        </Button>
      </div>
    </li>
  )
}

/** Recent decisions, derived from the suggestion trail so nothing is invented. */
function DecisionTrail() {
  const decided = MOCK_REVIEW_QUEUE.flatMap((item) =>
    item.criteria
      .filter((criterion) => criterion.decidedAt !== undefined)
      .map((criterion) => ({ id: criterion.id, criterion })),
  )
    .sort((a, b) => (b.criterion.decidedAt ?? "").localeCompare(a.criterion.decidedAt ?? ""))
    .slice(0, 6)

  if (decided.length === 0) {
    return (
      <EmptyState
        title="No decisions recorded yet"
        description="Accepting or overriding a suggestion writes an audit entry here."
      />
    )
  }

  const items: TimelineItem[] = decided.map(({ id, criterion }) => ({
    id,
    title: (
      <span>
        {criterion.studentName} · {criterion.criterionLabel}
      </span>
    ),
    description:
      criterion.finalPoints !== undefined && criterion.finalPoints !== criterion.suggestedPoints
        ? `Overridden to ${formatPoints(criterion.finalPoints, criterion.maxPoints)} — ${
            criterion.overrideReason ?? "no reason recorded"
          }`
        : `Accepted at ${formatPoints(criterion.suggestedPoints, criterion.maxPoints)} with no change`,
    meta: `${criterion.decidedBy ?? "auto-threshold"} · ${formatDateTime(
      criterion.decidedAt,
    )} · ${criterion.model} ${criterion.promptVersion}`,
    tone: REVIEW_STATE_TO_STATUS[criterion.state],
  }))

  return (
    <>
      <Timeline items={items} />
      <p className="mt-4 text-xs text-muted-foreground">
        Showing the {items.length} most recent criterion decisions of{" "}
        {MOCK_GRADE_SUGGESTIONS.length} recorded suggestions.
      </p>
    </>
  )
}
