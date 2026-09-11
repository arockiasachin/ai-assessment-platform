"use client"

import { useMemo, useState } from "react"
import { Loader2, Lock, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type {
  PeerEvaluationDimensionKeyValue,
  StudentPeerEvaluationGroup,
} from "@/lib/contracts/groups"
import { PEER_EVALUATION_DIMENSIONS } from "@/lib/groups/dimensions"

/**
 * Student peer-evaluation workspace.
 *
 * Confidentiality note shown to students: received results are an anonymous
 * aggregate and are only revealed once enough teammates have submitted. The
 * payload the server sends carries no evaluator identity and no received
 * free-text comments, so this component cannot display them even by accident.
 */

type RatingDraft = Record<PeerEvaluationDimensionKeyValue, number>

type EvaluationDraft = {
  ratings: RatingDraft
  comments: string
}

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
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          You are not currently a member of any group project, so there is nothing to evaluate.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {notice && (
        <p
          role="status"
          className="text-sm text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
        >
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3.5" />
        Your ratings are confidential. You can never see who rated you, and results appear only
        after enough teammates have submitted.
      </p>

      {groups.map((group) => {
        const received = group.received
        return (
          <Card key={group.groupId}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {group.groupName}
                <span className="text-sm font-normal text-muted-foreground">
                  {group.courseCode} · {group.courseName}
                </span>
                <Badge variant="outline">
                  {group.submittedEvaluations}/{group.expectedEvaluations} submitted
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">How your teammates rated you (anonymous)</p>
                {received.withheld ? (
                  <p className="mt-1 text-muted-foreground">{received.reason}</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {PEER_EVALUATION_DIMENSIONS.map((dimension) => (
                      <li key={dimension.key}>
                        {dimension.label}:{" "}
                        <span className="font-medium">
                          {received.dimensionAverages[dimension.key].toFixed(2)}
                        </span>
                      </li>
                    ))}
                    <li className="text-muted-foreground">
                      Overall {received.overallAverage.toFixed(2)} from {received.ratingCount}{" "}
                      teammate(s).
                    </li>
                  </ul>
                )}
              </div>

              {group.teammates.map((teammate) => {
                const draft = drafts[group.groupId]?.[teammate.studentId]
                return (
                  <div key={teammate.studentId} className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium">
                      {teammate.fullName}
                      {teammate.isSelf && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {PEER_EVALUATION_DIMENSIONS.map((dimension) => (
                        <label key={dimension.key} className="text-xs">
                          <span className="text-muted-foreground">{dimension.label}</span>
                          <select
                            className="mt-0.5 w-full rounded-md border border-border bg-background p-1 text-sm"
                            value={draft?.ratings[dimension.key] ?? 3}
                            onChange={(event) =>
                              updateRating(
                                group.groupId,
                                teammate.studentId,
                                dimension.key,
                                Number(event.target.value),
                              )
                            }
                          >
                            {[1, 2, 3, 4, 5].map((value) => (
                              <option key={value} value={value}>
                                {value} — {dimension.anchors[value - 1]}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <Input
                      className="mt-2"
                      aria-label={`Comment about ${teammate.fullName}`}
                      placeholder="Optional comment (visible only to the instructor)"
                      value={draft?.comments ?? ""}
                      onChange={(event) =>
                        updateComment(group.groupId, teammate.studentId, event.target.value)
                      }
                    />
                  </div>
                )
              })}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyGroup === group.groupId}
                  onClick={() => void submit(group.groupId, false)}
                >
                  {busyGroup === group.groupId ? <Loader2 className="size-4 animate-spin" /> : null}
                  Save draft
                </Button>
                <Button
                  size="sm"
                  disabled={busyGroup === group.groupId}
                  onClick={() => void submit(group.groupId, true)}
                >
                  <Send className="size-4" /> Submit evaluations
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
