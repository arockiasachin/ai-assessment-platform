import type { Metadata } from "next"
import { Lock, Users } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "../_lib/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { PEER_EVALUATION_DIMENSIONS } from "@/lib/groups/dimensions"
import {
  MOCK_DEMO_STUDENT,
  MOCK_GROUP_BY_ID,
  MOCK_MY_PEER_EVALUATIONS,
  formatDate,
  formatDateTime,
  formatDueLabel,
  trimNumber,
  type CatmeRatings,
  type GroupMember,
  type MilestoneState,
  type PeerEvaluation,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Peer evaluation",
}

/**
 * A dimension average is withheld until this many teammates have responded. In a
 * four-person team a single response would otherwise be trivially attributable —
 * which is the whole point of the round being confidential.
 */
const MIN_RESPONSES_TO_AGGREGATE = 2

const MILESTONE_STATUS: Record<MilestoneState, { status: StatusKey; label: string }> = {
  PLANNED: { status: "queued", label: "Planned" },
  IN_PROGRESS: { status: "in-progress", label: "In progress" },
  COMPLETED: { status: "completed", label: "Completed" },
  MISSED: { status: "missed", label: "Missed" },
}

/** An evaluation that has actually been submitted, so its ratings are readable. */
type SubmittedEvaluation = PeerEvaluation & { ratings: CatmeRatings }

function hasRatings(evaluation: PeerEvaluation): evaluation is SubmittedEvaluation {
  return evaluation.state === "SUBMITTED" && evaluation.ratings !== null
}

type TeamRow = {
  id: string
  member: GroupMember
  isSelf: boolean
  /** The overall score this student gave that teammate, when they submitted one. */
  yourRating: number | null
  completed: number
  required: number
}

const columns: Column<TeamRow>[] = [
  {
    id: "member",
    header: "Member",
    cell: (row) => (
      <span className="font-medium">
        {row.member.name}
        {row.isSelf && <span className="font-normal text-muted-foreground"> (you)</span>}
      </span>
    ),
  },
  {
    id: "role",
    header: "Team role",
    hideBelow: "sm",
    cell: (row) =>
      row.member.role === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <StatusPill status="active" label={row.member.role} dot />
      ),
  },
  {
    id: "register",
    header: "Register number",
    hideBelow: "lg",
    cell: (row) => (
      <span className="font-mono text-xs tabular-nums">{row.member.registerNumber}</span>
    ),
  },
  {
    id: "your-rating",
    header: "Your rating of them",
    align: "right",
    cell: (row) =>
      row.isSelf ? (
        <span className="text-muted-foreground">—</span>
      ) : row.yourRating === null ? (
        <StatusPill status="draft" label="Not submitted" />
      ) : (
        <span className="font-mono tabular-nums">{trimNumber(row.yourRating)} / 5</span>
      ),
  },
  {
    id: "completion",
    header: "Round completion",
    cell: (row) => {
      if (row.required === 0) return <span className="text-muted-foreground">—</span>
      if (row.completed === row.required) {
        return (
          <StatusPill
            status="completed"
            label={`Submitted · ${row.completed} of ${row.required}`}
            dot
          />
        )
      }
      if (row.completed === 0) {
        return <StatusPill status="pending" label="Not started" dot />
      }
      return (
        <StatusPill
          status="needs-review"
          label={`Draft · ${row.completed} of ${row.required}`}
          dot
        />
      )
    },
  },
]

function ConfidentialityNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg bg-muted p-3">
      <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1 text-sm">
        <p className="font-medium">Confidential by design</p>
        <p className="text-muted-foreground text-pretty">{children}</p>
      </div>
    </div>
  )
}

export default function StudentPeerEvaluationPage() {
  const student = MOCK_DEMO_STUDENT
  const team = student.groupId === null ? null : MOCK_GROUP_BY_ID[student.groupId]

  const teammates =
    team === null ? [] : team.members.filter((member) => member.studentId !== student.id)
  const requiredEvaluations = teammates.length
  const submittedEvaluations = MOCK_MY_PEER_EVALUATIONS.filter(
    (evaluation) => evaluation.state === "SUBMITTED",
  ).length
  const round = team?.milestones.find((milestone) =>
    milestone.title.toLowerCase().includes("peer evaluation"),
  )
  const roundStatus = round === undefined ? null : MILESTONE_STATUS[round.state]

  // ------------------------------------------- ratings about you, anonymous
  const ratingsAboutMe =
    team === null
      ? []
      : team.peerEvaluations
          .filter((evaluation) => evaluation.evaluateeId === student.id)
          .filter(hasRatings)

  const aggregateVisible = ratingsAboutMe.length >= MIN_RESPONSES_TO_AGGREGATE
  const aggregate = PEER_EVALUATION_DIMENSIONS.map((dimension) => {
    if (ratingsAboutMe.length === 0) return { dimension, average: null }
    const total = ratingsAboutMe.reduce(
      (sum, evaluation) => sum + evaluation.ratings[dimension.key],
      0,
    )
    return { dimension, average: total / ratingsAboutMe.length }
  })
  const overallAverage =
    ratingsAboutMe.length === 0
      ? null
      : aggregate.reduce((sum, entry) => sum + (entry.average ?? 0), 0) / aggregate.length

  // ---------------------------------------------------------------- team
  const teamRows: TeamRow[] =
    team === null
      ? []
      : team.members.map<TeamRow>((member) => {
          const isSelf = member.studentId === student.id
          const byMember = isSelf
            ? []
            : team.peerEvaluations.filter(
                (evaluation) => evaluation.evaluatorId === member.studentId,
              )
          const mineToMember = MOCK_MY_PEER_EVALUATIONS.find(
            (evaluation) => evaluation.evaluateeId === member.studentId,
          )
          return {
            id: member.studentId,
            member,
            isSelf,
            yourRating:
              mineToMember !== undefined && mineToMember.state === "SUBMITTED"
                ? mineToMember.overall
                : null,
            completed: byMember.filter((evaluation) => evaluation.state === "SUBMITTED").length,
            required: isSelf ? 0 : byMember.length,
          }
        })

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Peer evaluation" },
        ]}
        eyebrow={team?.name ?? "No team"}
        title="Peer evaluation"
        description="Rate teammates on the five CATME dimensions."
        actions={
          roundStatus === null ? undefined : (
            <StatusPill status={roundStatus.status} label={`Round 1 · ${roundStatus.label}`} />
          )
        }
      />

      <div className="space-y-6">
        <SectionCard
          title="Round progress"
          description={
            team === null
              ? "You are not in a team yet."
              : `${team.projectTitle} · every member rates every other member on five dimensions.`
          }
        >
          {team === null || requiredEvaluations === 0 ? (
            <EmptyState
              icon={Users}
              title="No peer evaluation round"
              description="There is no team to evaluate yet. This page fills in as soon as you are placed in a group."
            />
          ) : (
            <div className="space-y-4">
              <ProgressBar
                value={submittedEvaluations}
                max={requiredEvaluations}
                label="Evaluations submitted"
                valueText={`${submittedEvaluations} / ${requiredEvaluations}`}
                tone={submittedEvaluations === requiredEvaluations ? "success" : "primary"}
              />
              <div className="space-y-0.5">
                <MetricRow
                  label="Team"
                  value={<span className="font-mono tabular-nums">{team.name}</span>}
                  hint={`${team.members.length} members · each rates the other ${requiredEvaluations}`}
                />
                <MetricRow
                  label="Round closes"
                  value={
                    round?.dueAt ? (
                      <span className="font-mono tabular-nums">{formatDate(round.dueAt)}</span>
                    ) : (
                      "—"
                    )
                  }
                  hint={round?.dueAt ? formatDueLabel(round.dueAt) : "No date set yet"}
                />
              </div>
              <ConfidentialityNote>
                What you write about a teammate is never shown next to your name. Your team and your
                teacher see only aggregated scores and whether the round was completed — never who
                submitted which rating, and never a comment attributed to a person.
              </ConfidentialityNote>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Your ratings"
          description="What you submitted for each teammate, on the five CATME dimensions. The anchors are the official 1–5 descriptions, so a score means the same thing to everyone in the team."
        >
          {MOCK_MY_PEER_EVALUATIONS.length === 0 ? (
            <EmptyState
              icon={Users}
              title="You have not rated anyone yet"
              description="Open the round to rate each teammate on the five dimensions."
            />
          ) : (
            <ul className="divide-y divide-border">
              {MOCK_MY_PEER_EVALUATIONS.map((evaluation) => (
                <li key={evaluation.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">
                      {evaluation.evaluateeName}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {evaluation.state === "SUBMITTED" ? "rated by you" : "not submitted yet"}
                      </span>
                    </h3>
                    <StatusPill
                      status={evaluation.state === "SUBMITTED" ? "submitted" : "draft"}
                      dot
                    />
                  </div>

                  {evaluation.ratings === null ? (
                    <p className="text-sm text-muted-foreground">
                      This rating is still a draft, so no values are stored yet.
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {PEER_EVALUATION_DIMENSIONS.map((dimension) => {
                        const value = evaluation.ratings?.[dimension.key]
                        if (value === undefined) return null
                        return (
                          <MetricRow
                            key={dimension.key}
                            label={dimension.label}
                            value={<span className="font-mono tabular-nums">{value} / 5</span>}
                            hint={dimension.anchors[value - 1]}
                          />
                        )
                      })}
                      <MetricRow
                        label="Overall"
                        value={
                          evaluation.overall === null ? (
                            "—"
                          ) : (
                            <span className="font-mono tabular-nums">
                              {trimNumber(evaluation.overall)} / 5
                            </span>
                          )
                        }
                        hint="Mean of the five dimensions"
                      />
                    </div>
                  )}

                  <div className="space-y-0.5">
                    <MetricRow
                      label="Your comment"
                      value={
                        evaluation.comments === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="max-w-md text-pretty">{evaluation.comments}</span>
                        )
                      }
                    />
                    <MetricRow
                      label="Submitted"
                      value={
                        <span className="font-mono tabular-nums">
                          {formatDateTime(evaluation.submittedAt)}
                        </span>
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="How your teammates rated you"
          description="Anonymised: an average of the ratings about you, across the team. Nothing on this card can be traced back to one person."
        >
          {!aggregateVisible ? (
            <EmptyState
              icon={Lock}
              title="Not enough responses to show an average"
              description={`A dimension average is only shown once at least ${MIN_RESPONSES_TO_AGGREGATE} teammates have rated you — ${ratingsAboutMe.length} have so far. Withholding small samples is what stops a single rating from being attributable.`}
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-0.5">
                <MetricRow
                  label="Responses about you"
                  value={
                    <span className="font-mono tabular-nums">
                      {ratingsAboutMe.length} of {teammates.length}
                    </span>
                  }
                />
                <MetricRow
                  label="Overall average"
                  value={
                    <span className="font-mono tabular-nums">
                      {overallAverage === null ? "—" : `${overallAverage.toFixed(1)} / 5`}
                    </span>
                  }
                  hint="Mean of the five dimension averages below"
                />
              </div>

              <div className="space-y-3">
                {aggregate.map((entry) => (
                  <ProgressBar
                    key={entry.dimension.key}
                    value={entry.average ?? 0}
                    max={5}
                    label={entry.dimension.label}
                    valueText={entry.average === null ? "—" : `${entry.average.toFixed(1)} / 5`}
                  />
                ))}
              </div>

              <ConfidentialityNote>
                These are averages of {ratingsAboutMe.length} responses. The individual ratings,
                their comments and their authors are never returned to you, and no teammate&apos;s
                comment is shown at all while a small sample would make it identifying.
              </ConfidentialityNote>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Team"
          description="Who is in the team and whether each member has finished their part of the round."
        >
          {team === null || teamRows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No teammates yet"
              description="Your group has no members, so there is nobody to evaluate."
            />
          ) : (
            <div className="space-y-3">
              <DataTable
                caption="Team members and peer-evaluation completion"
                columns={columns}
                rows={teamRows}
                getRowId={(row) => row.id}
                empty={
                  <EmptyState
                    size="sm"
                    title="No teammates"
                    description="This group has no members yet."
                  />
                }
              />
              <p className="text-xs text-muted-foreground text-pretty">
                Completion is shared, content is not: this table shows that a teammate has finished,
                never what they wrote, how they scored you, or who rated whom.
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}
