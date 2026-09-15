import type { Metadata } from "next"
import { UserRoundPlus, Users, UsersRound, Wand2 } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import {
  MOCK_COURSE,
  MOCK_GROUP_BY_ID,
  MOCK_GROUPS,
  MOCK_UNASSIGNED_STUDENTS,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  type ContributionEvent,
  type Group,
  type GroupMember,
  type PeerEvaluation,
} from "@/lib/mock"
import { PEER_EVALUATION_DIMENSIONS } from "@/lib/groups/dimensions"

import {
  CATME_SHORT_LABEL,
  CONTRIBUTION_KIND_LABEL,
  GROUP_STATE_TO_STATUS,
  MILESTONE_STATE_LABEL,
  MILESTONE_STATE_TO_STATUS,
  PEER_STATE_TO_STATUS,
} from "../_lib/labels"
import { TeacherProgress } from "../_lib/teacher-progress"

export const metadata: Metadata = {
  title: "Groups",
}

const HREF = "/mockup/teacher/groups"

/** The team the detail panel opens on: active, evaluated, with a missed milestone. */
const DETAIL_GROUP: Group = MOCK_GROUP_BY_ID["grp_matrices"]

const MEMBERS_PLACED = MOCK_GROUPS.reduce((total, group) => total + group.members.length, 0)
const FREE_RIDERS = MOCK_GROUPS.reduce(
  (total, group) => total + group.members.filter((member) => member.freeRider).length,
  0,
)
const TEAMS_AWAITING_EVALUATION = MOCK_GROUPS.filter(
  (group) => group.members.length > 1 && group.peerEvaluations.length === 0,
)

/**
 * Groups — teams, peer evaluation, contribution evidence and milestones.
 *
 * Three shapes have to survive here: a team with a complete CATME round, a team
 * nobody has evaluated yet (which must render an empty state, not an empty
 * table), and a team that is still FORMING with no members at all.
 */
export default function TeacherGroupsPage() {
  const teamColumns: Column<Group>[] = [
    {
      id: "team",
      header: "Team",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p
            className="max-w-[22rem] truncate text-xs text-muted-foreground"
            title={row.projectTitle}
          >
            {row.projectTitle}
          </p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={GROUP_STATE_TO_STATUS[row.state]} dot />,
    },
    {
      id: "members",
      header: "Members",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.members.length}</span>,
    },
    {
      id: "contribution",
      header: "Avg contribution",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">{row.avgContribution.toFixed(2)}</span>
      ),
    },
    {
      id: "activity",
      header: "Last activity",
      hideBelow: "md",
      cell: (row) => (
        <span className="text-muted-foreground" title={formatDateTime(row.lastActivityAt)}>
          {formatRelativeTime(row.lastActivityAt)}
        </span>
      ),
    },
    {
      id: "flags",
      header: "Flags",
      hideBelow: "lg",
      cell: (row) => {
        const freeRiders = row.members.filter((member) => member.freeRider).length
        if (!row.similarityFlag && freeRiders === 0) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <span className="inline-flex flex-wrap gap-1">
            {freeRiders > 0 && (
              <StatusPill
                status="flagged"
                label={`${freeRiders} free-rider signal${freeRiders === 1 ? "" : "s"}`}
              />
            )}
            {row.similarityFlag && <StatusPill status="needs-review" label="Similarity flagged" />}
          </span>
        )
      },
    },
  ]

  const memberColumns: Column<GroupMember>[] = [
    {
      id: "member",
      header: "Member",
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
      id: "role",
      header: "Role",
      hideBelow: "sm",
      cell: (row) => row.role ?? <span className="text-xs text-muted-foreground">No role</span>,
    },
    {
      id: "share",
      header: "Contribution share",
      cell: (row) => (
        <TeacherProgress
          className="w-40"
          label={`Contribution share — ${row.name}`}
          value={row.contributionShare}
          valueText={`${row.contributionShare}%`}
          tone={row.freeRider ? "warning" : "primary"}
        />
      ),
    },
    {
      id: "adjustment",
      header: "Adjustment",
      align: "right",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.adjustmentFactor === null ? "—" : row.adjustmentFactor.toFixed(2)}
          {row.selfAdjustmentFactor !== null && (
            <span className="block text-xs text-muted-foreground">
              self {row.selfAdjustmentFactor.toFixed(2)}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "standing",
      header: "Standing",
      cell: (row) =>
        row.freeRider ? (
          <StatusPill status="flagged" label="Free-rider signal" dot />
        ) : (
          <StatusPill status="active" label="Contributing" dot />
        ),
    },
  ]

  const groupsAwaitingEvaluation = TEAMS_AWAITING_EVALUATION.length

  return (
    <>
      <PageHeader
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.section} · group project`}
        title="Groups"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Groups" },
        ]}
        actions={
          <Button>
            <Wand2 className="size-4" aria-hidden="true" />
            Form groups
          </Button>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Teams"
            value={String(MOCK_GROUPS.length)}
            hint={`${MOCK_GROUPS.filter((group) => group.state === "FORMING").length} still forming`}
            icon={UsersRound}
          />
          <StatCard
            label="Members placed"
            value={String(MEMBERS_PLACED)}
            hint={`${MOCK_COURSE.studentCount} enrolled in total`}
            icon={Users}
          />
          <StatCard
            label="Free-rider signals"
            value={String(FREE_RIDERS)}
            hint="Low peer ratings with low contribution evidence"
            icon={Users}
          />
          <StatCard
            label="Unassigned"
            value={String(MOCK_UNASSIGNED_STUDENTS.length)}
            hint="Enrolled but not placed in a team"
            icon={UserRoundPlus}
          />
        </div>

        <SectionCard
          title="Teams"
          description={`Contribution is measured from commit, pull-request and review evidence, plus the CATME peer round. ${groupsAwaitingEvaluation} team${
            groupsAwaitingEvaluation === 1 ? " has" : "s have"
          } not started peer evaluation.`}
        >
          <DataTable
            caption="Project teams"
            columns={teamColumns}
            rows={MOCK_GROUPS}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                icon={UsersRound}
                title="No teams yet"
                description="Form groups from the roster to start a project round."
                action={<Button>Form groups</Button>}
              />
            }
          />
        </SectionCard>

        <SectionCard
          title={`Team detail — ${DETAIL_GROUP.name}`}
          description={`${DETAIL_GROUP.projectTitle} · ${DETAIL_GROUP.members.length} members · average contribution ${DETAIL_GROUP.avgContribution.toFixed(2)}`}
          action={<StatusPill status={GROUP_STATE_TO_STATUS[DETAIL_GROUP.state]} dot />}
        >
          <PageTabs
            className="[&_[data-slot=tabs-list]]:overflow-x-auto"
            items={[
              { value: "members", label: "Members", count: DETAIL_GROUP.members.length },
              {
                value: "peer",
                label: "Peer evaluation",
                count: DETAIL_GROUP.peerEvaluations.length,
              },
              { value: "milestones", label: "Milestones", count: DETAIL_GROUP.milestones.length },
              {
                value: "contributions",
                label: "Contributions",
                count: DETAIL_GROUP.contributions.length,
              },
            ]}
            label={`${DETAIL_GROUP.name} sections`}
          >
            <PageTabPanel value="members">
              <DataTable
                caption={`Members of ${DETAIL_GROUP.name}`}
                columns={memberColumns}
                rows={DETAIL_GROUP.members}
                getRowId={(row) => row.studentId}
                empty={
                  <EmptyState
                    title="This team has no members"
                    description="Drag students in from the roster, or let the algorithm balance the teams."
                  />
                }
              />
            </PageTabPanel>

            <PageTabPanel value="peer" className="space-y-6">
              <section aria-labelledby="peer-covered">
                <h3 id="peer-covered" className="text-sm font-medium">
                  Ratings received, per evaluator
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Anonymous to students: a teammate never sees who rated them. Every rating uses the
                  five CATME dimensions on a 1–5 scale.
                </p>
                <ul className="mt-4 space-y-4">
                  {groupByEvaluator(DETAIL_GROUP.peerEvaluations).map((entry) => (
                    <li key={entry.evaluatorId} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-medium">{entry.evaluatorName}</h4>
                        <span className="text-xs text-muted-foreground">
                          {
                            entry.evaluations.filter(
                              (evaluation) => evaluation.state === "SUBMITTED",
                            ).length
                          }{" "}
                          of {entry.evaluations.length} submitted
                        </span>
                      </div>
                      <ul className="mt-3 space-y-3">
                        {entry.evaluations.map((evaluation) => (
                          <li key={evaluation.id}>
                            <PeerEvaluationRow evaluation={evaluation} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="peer-missing">
                <h3 id="peer-missing" className="text-sm font-medium">
                  Teams yet to start the round
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Nobody in these teams has opened the peer evaluation form.
                </p>
                <div className="mt-3">
                  {TEAMS_AWAITING_EVALUATION.length === 0 ? (
                    <EmptyState
                      title="Every team has started evaluating"
                      description="All teams with members have at least one submitted evaluation."
                    />
                  ) : (
                    <div className="space-y-3">
                      {TEAMS_AWAITING_EVALUATION.map((group) => (
                        <EmptyState
                          key={group.id}
                          icon={Users}
                          title={`No peer evaluations yet — ${group.name}`}
                          description={`${group.members.length} members, ${group.members.length * (group.members.length - 1)} ratings expected. Nobody in this team has started the CATME round.`}
                          action={<Button variant="outline">Send reminder</Button>}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </PageTabPanel>

            <PageTabPanel value="milestones">
              {DETAIL_GROUP.milestones.length === 0 ? (
                <EmptyState
                  title="No milestones planned"
                  description="Add project milestones so contribution can be tracked against them."
                />
              ) : (
                <Timeline
                  items={DETAIL_GROUP.milestones.map((milestone): TimelineItem => ({
                    id: milestone.id,
                    title: (
                      <span className="flex flex-wrap items-center gap-2">
                        {milestone.title}
                        <StatusPill
                          status={MILESTONE_STATE_TO_STATUS[milestone.state]}
                          label={MILESTONE_STATE_LABEL[milestone.state]}
                          dot
                        />
                      </span>
                    ),
                    description: milestone.description,
                    meta: `Weight ${milestone.weight} · due ${formatDateTime(
                      milestone.dueAt,
                    )} · ${milestone.completedAt ? `completed ${formatDateTime(milestone.completedAt)}` : "not completed"}`,
                    tone: MILESTONE_STATE_TO_STATUS[milestone.state],
                  }))}
                />
              )}
            </PageTabPanel>

            <PageTabPanel value="contributions">
              {DETAIL_GROUP.contributions.length === 0 ? (
                <EmptyState
                  title="No contribution evidence"
                  description="Commits, pull requests and reviews appear here once the team links a repository."
                />
              ) : (
                <>
                  <Timeline
                    items={DETAIL_GROUP.contributions.map((event): TimelineItem => ({
                      id: event.id,
                      title: (
                        <span className="flex flex-wrap items-center gap-2">
                          {event.summary}
                          <StatusPill
                            status={event.weight < 1 ? "needs-review" : "active"}
                            label={CONTRIBUTION_KIND_LABEL[event.kind]}
                          />
                        </span>
                      ),
                      description: event.studentName
                        ? `${event.studentName} · weight ${event.weight}`
                        : `Unattributed · weight ${event.weight}`,
                      meta: formatDateTime(event.occurredAt),
                      tone: event.weight < 1 ? "needs-review" : "active",
                    }))}
                  />
                  <p className="mt-4 text-xs text-muted-foreground">
                    {contributionSummary(DETAIL_GROUP.contributions)}
                  </p>
                </>
              )}
            </PageTabPanel>
          </PageTabs>
        </SectionCard>

        <SectionCard
          title="Formation"
          description="Who is still waiting for a team, and the team that has not been populated."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="unassigned">
              <h3 id="unassigned" className="text-sm font-medium">
                Students not in a team
              </h3>
              <div className="mt-3">
                {MOCK_UNASSIGNED_STUDENTS.length === 0 ? (
                  <EmptyState
                    icon={UsersRound}
                    title="Everyone is placed"
                    description="Every enrolled student belongs to a team."
                  />
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {MOCK_UNASSIGNED_STUDENTS.map((student) => (
                      <li
                        key={student.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={student.name}>
                            {student.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {student.registerNumber} ·{" "}
                            {student.avgPercent === null
                              ? "no published marks"
                              : `average ${formatPercent(student.avgPercent)}`}
                          </p>
                        </div>
                        <StatusPill status="flagged" label="Unassigned" dot />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="forming">
              <h3 id="forming" className="text-sm font-medium">
                Still forming
              </h3>
              <div className="mt-3">
                {MOCK_GROUPS.filter((group) => group.state === "FORMING").map((group) => (
                  <EmptyState
                    key={group.id}
                    icon={Users}
                    title={`${group.name} has no members yet`}
                    description={`${group.projectTitle}. The team exists so it can be balanced automatically, but nobody has been placed in it.`}
                    action={<Button variant="outline">Populate team</Button>}
                  />
                ))}
              </div>
            </section>
          </div>
        </SectionCard>

        <SectionCard
          title="Peer evaluation round"
          description="How the CATME round feeds the group mark."
        >
          <div className="space-y-1">
            <MetricRow
              label="Dimension scale"
              value="1–5"
              hint={PEER_EVALUATION_DIMENSIONS.map((dimension) => dimension.label).join(" · ")}
            />
            <MetricRow
              label="Ratings submitted"
              value={`${MOCK_GROUPS.reduce(
                (total, group) =>
                  total +
                  group.peerEvaluations.filter((evaluation) => evaluation.state === "SUBMITTED")
                    .length,
                0,
              )} of ${MOCK_GROUPS.reduce(
                (total, group) => total + group.peerEvaluations.length,
                0,
              )}`}
              hint="Draft ratings are not counted"
            />
            <MetricRow
              label="Adjustment factors"
              value="Applied after the round closes"
              hint="A student's factor is applied to the shared team mark"
            />
          </div>
        </SectionCard>
      </div>
    </>
  )
}

type EvaluatorGroup = {
  evaluatorId: string
  evaluatorName: string
  evaluations: PeerEvaluation[]
}

function groupByEvaluator(evaluations: PeerEvaluation[]): EvaluatorGroup[] {
  const groups = new Map<string, EvaluatorGroup>()
  for (const evaluation of evaluations) {
    const existing = groups.get(evaluation.evaluatorId)
    if (existing) {
      existing.evaluations.push(evaluation)
    } else {
      groups.set(evaluation.evaluatorId, {
        evaluatorId: evaluation.evaluatorId,
        evaluatorName: evaluation.evaluatorName,
        evaluations: [evaluation],
      })
    }
  }
  return [...groups.values()]
}

/** One evaluatee's five CATME ratings, or the reason there are none. */
function PeerEvaluationRow({ evaluation }: { evaluation: PeerEvaluation }) {
  return (
    <div className="rounded-md bg-muted/50 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Rated {evaluation.evaluateeName}</p>
        <span className="inline-flex items-center gap-2">
          {evaluation.overall !== null && (
            <span className="font-mono text-xs tabular-nums">
              overall {evaluation.overall.toFixed(2)} / 5
            </span>
          )}
          <StatusPill status={PEER_STATE_TO_STATUS[evaluation.state]} dot />
        </span>
      </div>

      {evaluation.ratings === null ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          This rating is still a draft — the values are hidden until it is submitted
          {evaluation.submittedAt === null
            ? ""
            : ` (last edited ${formatDateTime(evaluation.submittedAt)})`}
          .
        </p>
      ) : (
        <>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(evaluation.ratings).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-muted-foreground">
                  {CATME_SHORT_LABEL[key as keyof typeof CATME_SHORT_LABEL] ?? key}
                </dt>
                <dd className="font-mono text-xs tabular-nums">{value} / 5</dd>
              </div>
            ))}
          </dl>
          {evaluation.comments && (
            <p className="mt-2 text-xs text-muted-foreground text-pretty">
              “{evaluation.comments}”
            </p>
          )}
        </>
      )}
    </div>
  )
}

function contributionSummary(events: ContributionEvent[]): string {
  const total = events.reduce((sum, event) => sum + event.weight, 0)
  const attributed = events.filter((event) => event.studentId !== null).length
  return `${events.length} contribution events (${attributed} attributed), total weight ${total.toFixed(
    2,
  )}. A weight below 1 marks lighter-than-expected evidence.`
}
