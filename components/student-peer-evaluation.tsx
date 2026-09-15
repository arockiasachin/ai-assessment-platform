"use client"

import { useMemo, useState } from "react"
import { Loader2, Lock, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Input } from "@/components/ui/input"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
import type {
  PeerEvaluationDimensionKeyValue,
  StudentPeerEvaluationGroup,
  TeammateResponse,
} from "@/lib/contracts/groups"
import { PEER_EVALUATION_DIMENSIONS } from "@/lib/groups/dimensions"

/**
 * Student peer-evaluation workspace.
 *
 * A **merge**, not a restyle: the mockup is a read-only report, while this page is
 * the only place a student can actually submit a peer evaluation. So the rating
 * form is kept (it is the write path) and the mockup's reporting cards are added
 * around it. Replacing the component outright would have deleted the feature.
 *
 * Confidentiality, which the layout has to reinforce rather than merely state:
 * the server payload carries no evaluator identity and no received free-text
 * comments, so this component cannot reveal who rated whom even by accident. The
 * disclosure threshold is read from `received.minRatersRequired` rather than a
 * local constant — the mockup hardcoded 2 where the server requires 3, and the
 * larger number is the privacy control.
 */

type RatingDraft = Record<PeerEvaluationDimensionKeyValue, number>

type EvaluationDraft = {
  ratings: RatingDraft
  comments: string
}

/** Five-point CATME scale; the anchors come from `PEER_EVALUATION_DIMENSIONS`. */
const RATING_VALUES = [1, 2, 3, 4, 5] as const

/** Neutral starting point, used until the student picks a value. */
const DEFAULT_RATINGS: RatingDraft = {
  contributing: 3,
  interacting: 3,
  keepingOnTrack: 3,
  expectingQuality: 3,
  knowledgeSkillsAbilities: 3,
}

function buildDrafts(group: StudentPeerEvaluationGroup): Record<string, EvaluationDraft> {
  const drafts: Record<string, EvaluationDraft> = {}
  for (const teammate of group.teammates) {
    const existing = group.myEvaluations.find(
      (evaluation) => evaluation.evaluateeId === teammate.studentId,
    )
    drafts[teammate.studentId] = {
      ratings: existing?.ratings ? { ...existing.ratings } : { ...DEFAULT_RATINGS },
      comments: existing?.comments ?? "",
    }
  }
  return drafts
}

export function StudentPeerEvaluation({
  initialGroups,
}: {
  initialGroups: StudentPeerEvaluationGroup[]
}) {
  const [groups, setGroups] = useState(initialGroups)
  const [drafts, setDrafts] = useState<Record<string, Record<string, EvaluationDraft>>>(() =>
    Object.fromEntries(initialGroups.map((group) => [group.groupId, buildDrafts(group)])),
  )
  const [busyGroup, setBusyGroup] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const groupById = useMemo(() => new Map(groups.map((group) => [group.groupId, group])), [groups])

  function updateRating(
    groupId: string,
    evaluateeId: string,
    dimension: PeerEvaluationDimensionKeyValue,
    value: number,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        [evaluateeId]: {
          ...prev[groupId]?.[evaluateeId],
          ratings: { ...prev[groupId]?.[evaluateeId]?.ratings, [dimension]: value },
        },
      },
    }))
  }

  function updateComment(groupId: string, evaluateeId: string, comments: string) {
    setDrafts((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        [evaluateeId]: { ...prev[groupId]?.[evaluateeId], comments },
      },
    }))
  }

  async function reload() {
    const response = await fetch("/api/student/peer-evaluation")
    const data = (await response.json().catch(() => ({}))) as {
      groups?: StudentPeerEvaluationGroup[]
      message?: string
    }
    if (!response.ok || !data.groups) throw new Error(data.message ?? "Unable to reload.")
    setGroups(data.groups)
    setDrafts(Object.fromEntries(data.groups.map((group) => [group.groupId, buildDrafts(group)])))
  }

  async function submit(groupId: string, submitForReal: boolean) {
    const group = groupById.get(groupId)
    if (!group) return
    setBusyGroup(groupId)
    setError(null)
    setNotice(null)
    try {
      const evaluations = group.teammates.map((teammate) => {
        const draft = drafts[groupId]?.[teammate.studentId]
        return {
          evaluateeId: teammate.studentId,
          ratings: draft?.ratings ?? DEFAULT_RATINGS,
          ...(draft?.comments.trim() ? { comments: draft.comments.trim() } : {}),
        }
      })
      const response = await fetch("/api/student/peer-evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, evaluations, submit: submitForReal }),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) throw new Error(data.message ?? "Unable to save your evaluations.")
      setNotice(data.message ?? "Saved.")
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your evaluations.")
    } finally {
      setBusyGroup(null)
    }
  }

  if (groups.length === 0) {
    return (
      <SectionCard title="Peer evaluation">
        <p className="text-sm text-muted-foreground">
          You are not currently a member of any group project, so there is nothing to evaluate.
        </p>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status">
          <Callout tone="success" title="Saved">
            {notice}
          </Callout>
        </div>
      )}
      {error && (
        <div role="alert">
          <Callout tone="destructive" title="Could not save">
            {error}
          </Callout>
        </div>
      )}

      {groups.map((group) => (
        <GroupPanel
          key={group.groupId}
          group={group}
          draft={drafts[group.groupId] ?? {}}
          busy={busyGroup === group.groupId}
          onRate={updateRating}
          onComment={updateComment}
          onSave={() => void submit(group.groupId, false)}
          onSubmit={() => void submit(group.groupId, true)}
        />
      ))}
    </div>
  )
}

/**
 * One group's workspace. Split out so the withheld/aggregate union narrows once,
 * and so the reporting cards read as their own unit rather than as a deeply
 * nested branch inside the parent.
 */
function GroupPanel({
  group,
  draft,
  busy,
  onRate,
  onComment,
  onSave,
  onSubmit,
}: {
  group: StudentPeerEvaluationGroup
  draft: Record<string, EvaluationDraft>
  busy: boolean
  onRate: (
    groupId: string,
    evaluateeId: string,
    dimension: PeerEvaluationDimensionKeyValue,
    value: number,
  ) => void
  onComment: (groupId: string, evaluateeId: string, comments: string) => void
  onSave: () => void
  onSubmit: () => void
}) {
  const received = group.received
  const selfEvaluation = group.myEvaluations.find(
    (evaluation) =>
      evaluation.evaluateeId === group.teammates.find((teammate) => teammate.isSelf)?.studentId,
  )
  const others = group.teammates.filter((teammate) => !teammate.isSelf)

  const columns: Column<TeammateResponse>[] = [
    {
      id: "teammate",
      header: "Teammate",
      cell: (teammate) => (
        <span className="font-medium">
          {teammate.fullName}
          {teammate.isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
        </span>
      ),
    },
    {
      id: "register",
      header: "Register no.",
      hideBelow: "sm",
      cell: (teammate) => (
        <span className="font-mono text-xs text-muted-foreground">{teammate.registerNumber}</span>
      ),
    },
    {
      id: "rating",
      header: "Your overall",
      align: "right",
      cell: (teammate) => {
        const mine = group.myEvaluations.find(
          (evaluation) => evaluation.evaluateeId === teammate.studentId,
        )
        // `overallScore` is null while the evaluation is still a draft, so this
        // reads "Not rated" rather than implying a score of zero.
        return mine?.overallScore == null ? (
          <span className="text-muted-foreground">
            Not rated<span className="sr-only"> yet for {teammate.fullName}</span>
          </span>
        ) : (
          <span className="font-mono tabular-nums">{mine.overallScore.toFixed(2)}</span>
        )
      },
    },
    {
      id: "state",
      header: "State",
      cell: (teammate) => {
        const mine = group.myEvaluations.find(
          (evaluation) => evaluation.evaluateeId === teammate.studentId,
        )
        return mine ? (
          <StatusPill
            status={mine.status === "SUBMITTED" ? "submitted" : "draft"}
            label={mine.status === "SUBMITTED" ? "Submitted" : "Draft"}
            dot
          />
        ) : (
          <span className="text-muted-foreground">Not started</span>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">
      <SectionCard
        title={`Round progress — ${group.groupName}`}
        description={`${group.courseCode} · ${group.courseName}`}
        action={
          <StatusPill
            status={selfEvaluation?.status === "SUBMITTED" ? "completed" : "pending"}
            label={
              selfEvaluation?.status === "SUBMITTED"
                ? "Your self-rating is in"
                : "Self-rating outstanding"
            }
            dot
          />
        }
      >
        <div className="space-y-4">
          <ProgressBar
            value={group.submittedEvaluations}
            max={group.expectedEvaluations}
            label="Evaluations submitted"
            valueText={`${group.submittedEvaluations} of ${group.expectedEvaluations}`}
          />
          <div>
            <MetricRow label="Teammates to rate" value={others.length} />
            <MetricRow
              label="Your self-rating"
              value={selfEvaluation?.status === "SUBMITTED" ? "Submitted" : "Not submitted"}
              hint="Rating yourself is expected but not required"
            />
          </div>
          <Callout tone="info" icon={Lock}>
            {/* The threshold comes from the server, never a local constant. */}
            Results appear only after at least {received.minRatersRequired} teammates have
            submitted, so no individual rating can be attributed. You will never see who rated you.
          </Callout>
        </div>
      </SectionCard>

      <SectionCard
        title="Your ratings"
        description="Rate each teammate on five behaviourally-anchored dimensions. Comments are visible only to the instructor."
      >
        <div className="space-y-5">
          {group.teammates.map((teammate) => {
            const teammateDraft = draft[teammate.studentId]
            return (
              <div
                key={teammate.studentId}
                className="space-y-3 rounded-lg border border-border p-3"
              >
                <p className="text-sm font-medium">
                  {teammate.fullName}
                  {teammate.isSelf && (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  )}
                </p>
                <div className="space-y-3">
                  {PEER_EVALUATION_DIMENSIONS.map((dimension) => {
                    const current = teammateDraft?.ratings[dimension.key] ?? 3
                    return (
                      <div
                        key={dimension.key}
                        className="grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{dimension.label}</p>
                          {/* The anchor makes the number mean something. */}
                          <p className="text-xs text-foreground">
                            {dimension.anchors[current - 1]}
                          </p>
                        </div>
                        <Select
                          value={String(current)}
                          items={RATING_VALUES.map((value) => ({
                            value: String(value),
                            label: `${value} of 5`,
                          }))}
                          onValueChange={(next) =>
                            onRate(group.groupId, teammate.studentId, dimension.key, Number(next))
                          }
                        >
                          <SelectTrigger
                            aria-label={`${dimension.label} for ${teammate.fullName}`}
                            className="w-full sm:w-28"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RATING_VALUES.map((value) => (
                              <SelectItem key={value} value={String(value)}>
                                {value} — {dimension.anchors[value - 1]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
                <Input
                  aria-label={`Comment about ${teammate.fullName}`}
                  placeholder="Optional comment (visible only to the instructor)"
                  value={teammateDraft?.comments ?? ""}
                  onChange={(event) =>
                    onComment(group.groupId, teammate.studentId, event.target.value)
                  }
                />
              </div>
            )
          })}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onSave}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save draft
            </Button>
            <Button size="sm" disabled={busy} onClick={onSubmit}>
              <Send className="size-4" aria-hidden="true" />
              Submit evaluations
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="How your teammates rated you"
        description="Anonymous by construction: the data this page receives carries no rater identity."
      >
        {received.withheld ? (
          <div className="space-y-3">
            <Callout tone="warning" title="Not shown yet">
              {received.reason}
            </Callout>
            <MetricRow
              label="Ratings received"
              value={`${received.ratingCount} of ${received.minRatersRequired} needed`}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {PEER_EVALUATION_DIMENSIONS.map((dimension) => {
              const average = received.dimensionAverages[dimension.key]
              return (
                <div key={dimension.key} className="space-y-1.5">
                  <MetricRow label={dimension.label} value={average.toFixed(2)} />
                  <ProgressBar value={average} max={5} label={`${dimension.label} average`} />
                </div>
              )
            })}
            <MetricRow
              label="Overall"
              value={received.overallAverage.toFixed(2)}
              hint={`From ${received.ratingCount} teammate${received.ratingCount === 1 ? "" : "s"}`}
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Team" description="Every member of this group, including you.">
        <DataTable
          caption={`Members of ${group.groupName}`}
          columns={columns}
          rows={group.teammates}
          getRowId={(teammate) => teammate.studentId}
          hideCaption
        />
      </SectionCard>
    </div>
  )
}
