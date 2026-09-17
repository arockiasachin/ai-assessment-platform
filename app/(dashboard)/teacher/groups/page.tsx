import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ShieldAlert, UserRoundPlus, Users, UsersRound, Wand2 } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import {
  GroupContributionForm,
  GroupFormationPanel,
  GroupGradeSuggestionForm,
  GroupMilestoneActions,
  GroupMilestoneForm,
  GroupsOfferingPicker,
} from "@/components/teacher-groups-manager"
import { buttonVariants } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"
import { TruncatedText } from "@/components/ui/truncated-text"
import { getSessionUser } from "@/lib/auth"
import type {
  GroupAnalysisResponse,
  GroupMemberResponse,
  GroupSummary,
  MilestoneResponse,
  PeerEvaluationPair,
  ProjectAssessmentOption,
  RosterStudent,
} from "@/lib/contracts/groups"
import {
  MIN_RATERS_FOR_DISCLOSURE,
  PEER_EVALUATION_DIMENSIONS,
  getOfferingAnalysisForTeacher,
  listGroupProjectAssessmentsForTeacher,
  listGroupsForTeacher,
  listMilestonesForTeacher,
  listOfferingRosterForTeacher,
  listTeacherOfferings,
  overallFromRatings,
  serializeGroupAnalysis,
} from "@/lib/groups"
import {
  CATME_SHORT_LABEL,
  CONTRIBUTION_KIND_LABEL,
  GROUP_STATE_TO_STATUS,
  MILESTONE_STATE_LABEL,
  MILESTONE_STATE_TO_STATUS,
} from "@/lib/labels"
import { formatDate, formatDateTime, trimNumber } from "@/lib/format"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Groups" }

type PageSearchParams = {
  offeringId?: string | string[]
  groupId?: string | string[]
  groupGrade?: string | string[]
  /** Narrow the Teams table to one GROUP_PROJECT assessment's teams (TN-49). */
  assessmentId?: string | string[]
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The latest recorded contribution event in a group, or `null` when nothing has
 * been recorded. It is `max(summaries[].lastAt)` — there is no `lastActivityAt`
 * column, and a group with no events must render an em dash rather than a
 * placeholder date.
 */
function lastActivityAt(entry: GroupAnalysisResponse | undefined): string | null {
  const timestamps = (entry?.contributionEvidence.summaries ?? [])
    .map((summary) => summary.lastAt)
    .filter((value): value is string => value !== null)
  if (timestamps.length === 0) return null
  return timestamps.reduce((latest, value) => (value > latest ? value : latest))
}

/** A member's share of the group's recorded contribution weight, or `null`. */
function contributionShare(entry: GroupAnalysisResponse | null, studentId: string): number | null {
  const summaries = entry?.contributionEvidence.summaries ?? []
  const total = summaries.reduce((sum, summary) => sum + summary.totalWeight, 0)
  if (total <= 0) return null
  const own = summaries.find((summary) => summary.studentId === studentId)?.totalWeight ?? 0
  return (own / total) * 100
}

/** The live analysis factor, falling back to the persisted roster column. */
function adjustmentFactor(
  entry: GroupAnalysisResponse | null,
  member: GroupMemberResponse,
  self: boolean,
): number | null {
  const factors = self ? entry?.withSelf : entry?.withoutSelf
  const fromAnalysis = factors?.find((row) => row.studentId === member.studentId)
  if (fromAnalysis) return fromAnalysis.adjustmentFactor
  return self ? member.selfAdjustmentFactor : member.adjustmentFactor
}

function contributionLabel(type: string): string {
  return (CONTRIBUTION_KIND_LABEL as Record<string, string>)[type] ?? type
}

type EvaluatorPairs = {
  evaluatorId: string
  evaluatorName: string
  pairs: PeerEvaluationPair[]
}

function groupPairsByEvaluator(pairs: readonly PeerEvaluationPair[]): EvaluatorPairs[] {
  const grouped = new Map<string, EvaluatorPairs>()
  for (const pair of pairs) {
    const existing = grouped.get(pair.evaluatorId)
    if (existing) {
      existing.pairs.push(pair)
    } else {
      grouped.set(pair.evaluatorId, {
        evaluatorId: pair.evaluatorId,
        evaluatorName: pair.evaluatorName,
        pairs: [pair],
      })
    }
  }
  return [...grouped.values()]
}

/** One evaluatee's five CATME ratings, or the reason there are none. */
function PairRow({ pair }: { pair: PeerEvaluationPair }) {
  const ratings = pair.ratings
  const overall = ratings === null ? null : overallFromRatings(ratings)
  const dimensionRows =
    ratings === null
      ? []
      : PEER_EVALUATION_DIMENSIONS.map((dimension) => ({
          key: dimension.key,
          label: CATME_SHORT_LABEL[dimension.key],
          value: ratings[dimension.key],
        }))

  return (
    <div className="rounded-md bg-muted/50 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Rated {pair.evaluateeName}</p>
        <span className="inline-flex items-center gap-2">
          {overall !== null && (
            <span className="font-mono text-xs tabular-nums">overall {overall.toFixed(2)} / 5</span>
          )}
          <StatusPill status={pair.status === "SUBMITTED" ? "submitted" : "draft"} dot />
        </span>
      </div>

      {ratings === null ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          This rating is still a draft — the values stay hidden until it is submitted.
        </p>
      ) : (
        <>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {dimensionRows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-2">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="font-mono text-xs tabular-nums">{row.value} / 5</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Submitted {formatDateTime(pair.submittedAt)}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Groups — teams, CATME-style peer evaluation, contribution evidence and
 * milestones.
 *
 * The five reads run here, on the server, for the offering named by
 * `?offeringId=`, and the selected team is named by `?groupId=` — so the detail
 * panel is server-rendered and the old four-endpoint client re-fetch is gone.
 * Only the six mutations remain a client island
 * (`components/teacher-groups-manager.tsx`).
 *
 * Deliberate omissions, so nothing renders a number nothing derives:
 *
 *  - "Similarity flagged" is dropped. `SimilarityCheck` is per student-pair per
 *    code task with no group relation, so there is no group-level flag to show.
 *  - the mockup's "Avg contribution" is not reproduced as a baseline. The
 *    contribution column is each member's **share of the group's recorded
 *    weight**, which is what the data can honestly say.
 *  - "Last activity" is `max(ContributionEvent.occurredAt)` and shows an em dash
 *    when a group has recorded no events.
 *  - the free-rider signal comes from the rating rule in `lib/groups/free-rider`;
 *    contribution alone never flags a member.
 *  - draft ratings are listed as pairs but their values are hidden, matching the
 *    boundary the student UI draws.
 */
export default async function TeacherGroupsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const requestedOfferingId = firstParam(params.offeringId)
  const requestedGroupId = firstParam(params.groupId)
  const requestedAssessmentId = firstParam(params.assessmentId)
  const groupGradeParam = firstParam(params.groupGrade)
  let groupGrade: number | undefined
  if (groupGradeParam !== undefined) {
    const parsed = Number(groupGradeParam)
    if (Number.isFinite(parsed) && parsed >= 0) groupGrade = parsed
  }

  const offerings = await listTeacherOfferings(user)
  const selectedOffering =
    offerings.find((offering) => offering.id === requestedOfferingId) ?? offerings[0] ?? null

  let groups: GroupSummary[] = []
  let roster: RosterStudent[] = []
  let analysis: GroupAnalysisResponse[] = []
  let milestones: MilestoneResponse[] = []
  let projectAssessments: ProjectAssessmentOption[] = []

  if (selectedOffering) {
    const [groupList, rosterList, offeringAnalysis, milestoneList, assessmentList] =
      await Promise.all([
        listGroupsForTeacher(user, selectedOffering.id, requestedAssessmentId),
        listOfferingRosterForTeacher(user, selectedOffering.id),
        getOfferingAnalysisForTeacher(user, {
          offeringId: selectedOffering.id,
          ...(requestedAssessmentId !== undefined ? { assessmentId: requestedAssessmentId } : {}),
          ...(groupGrade !== undefined ? { groupGrade } : {}),
        }),
        listMilestonesForTeacher(user, { offeringId: selectedOffering.id }),
        listGroupProjectAssessmentsForTeacher(user, selectedOffering.id),
      ])
    groups = groupList
    roster = rosterList
    projectAssessments = assessmentList
    analysis = offeringAnalysis.groups.map((entry) =>
      serializeGroupAnalysis(
        entry.analysis,
        entry.contributionEvidence,
        entry.suggestedIndividualGrades,
        entry.peerEvaluationPairs,
      ),
    )
    milestones = milestoneList.milestones
  }

  const analysisByGroup = new Map(analysis.map((entry) => [entry.groupId, entry]))
  const selectedGroup = groups.find((group) => group.id === requestedGroupId) ?? groups[0] ?? null
  const selectedEntry = selectedGroup ? (analysisByGroup.get(selectedGroup.id) ?? null) : null
  const selectedMilestones = selectedGroup
    ? milestones.filter((milestone) => milestone.groupId === selectedGroup.id)
    : []
  const suggestions = selectedEntry?.suggestedIndividualGrades ?? null

  const formingCount = groups.filter((group) => group.status === "FORMING").length
  const membersPlaced = groups.reduce((total, group) => total + group.memberCount, 0)
  const placedStudentIds = new Set(
    groups.flatMap((group) => group.members.map((member) => member.studentId)),
  )
  const unassigned = roster.filter((student) => !placedStudentIds.has(student.studentId))
  const flaggedFreeRiders = analysis.reduce(
    (total, entry) => total + entry.freeRiders.filter((signal) => signal.flagged).length,
    0,
  )

  const submittedRatings = analysis.reduce(
    (total, entry) => total + entry.submittedEvaluationCount,
    0,
  )
  // Every member rates every member, including a self-evaluation, so the expected
  // row count for a team of n is n².
  const expectedRatings = groups.reduce((total, group) => total + group.memberCount ** 2, 0)
  const suggestionCount = analysis.reduce(
    (total, entry) => total + (entry.suggestedIndividualGrades?.length ?? 0),
    0,
  )
  const teamsAwaitingEvaluation = groups.filter(
    (group) =>
      group.memberCount > 1 && (analysisByGroup.get(group.id)?.submittedEvaluationCount ?? 0) === 0,
  )

  const teamColumns: Column<GroupSummary>[] = [
    {
      id: "team",
      header: "Team",
      cell: (group) => (
        <div className="min-w-0">
          <p className="font-medium">{group.name}</p>
          <p
            className="max-w-[22rem] truncate text-xs text-muted-foreground"
            title={group.projectTitle ?? undefined}
          >
            {group.projectTitle ?? "No project title"}
          </p>
        </div>
      ),
    },
    {
      id: "assessment",
      header: "Project assessment",
      hideBelow: "lg",
      cell: (group) =>
        group.assessmentId ? (
          <Link
            href={{
              pathname: "/teacher/groups",
              query: { offeringId: group.offeringId, assessmentId: group.assessmentId },
            }}
            className="underline-offset-4 hover:underline"
          >
            {group.assessmentTitle ?? "Linked assessment"}
          </Link>
        ) : (
          <span className="text-muted-foreground">Not linked</span>
        ),
    },
    {
      id: "state",
      header: "State",
      cell: (group) => <StatusPill status={GROUP_STATE_TO_STATUS[group.status]} dot />,
    },
    {
      id: "members",
      header: "Members",
      align: "right",
      cell: (group) => <span className="font-mono tabular-nums">{group.memberCount}</span>,
    },
    {
      id: "milestones",
      header: "Milestones",
      align: "right",
      hideBelow: "sm",
      cell: (group) => (
        <span className="font-mono tabular-nums">
          {group.milestoneProgress.completed}/{group.milestoneProgress.total}
          <span className="block text-xs text-muted-foreground">
            {Math.round(group.milestoneProgress.weightedCompletion * 100)}% weighted
          </span>
        </span>
      ),
    },
    {
      id: "activity",
      header: "Last activity",
      hideBelow: "md",
      cell: (group) => {
        const lastAt = lastActivityAt(analysisByGroup.get(group.id))
        return (
          <span className="text-muted-foreground">{lastAt ? formatDateTime(lastAt) : "—"}</span>
        )
      },
    },
    {
      id: "flags",
      header: "Flags",
      hideBelow: "lg",
      cell: (group) => {
        const freeRiders =
          analysisByGroup.get(group.id)?.freeRiders.filter((signal) => signal.flagged).length ?? 0
        if (!group.behind && !group.lopsided && freeRiders === 0) {
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
            {group.behind && <StatusPill status="missed" label="Behind" />}
            {group.lopsided && <StatusPill status="needs-review" label="Lopsided" />}
          </span>
        )
      },
    },
  ]

  const memberColumns: Column<GroupMemberResponse>[] = [
    {
      id: "member",
      header: "Member",
      cell: (member) => (
        <div className="min-w-0">
          <TruncatedText className="font-medium" title={member.fullName}>
            {member.fullName}
          </TruncatedText>
          <p className="text-xs text-muted-foreground">{member.registerNumber}</p>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      hideBelow: "sm",
      cell: (member) =>
        member.role ?? <span className="text-xs text-muted-foreground">No role</span>,
    },
    {
      id: "share",
      header: "Contribution share",
      cell: (member) => {
        const share = contributionShare(selectedEntry, member.studentId)
        if (share === null) return <span className="text-muted-foreground">—</span>
        const flagged =
          selectedEntry?.freeRiders.find((signal) => signal.studentId === member.studentId)
            ?.flagged ?? false
        return (
          <ProgressBar
            className="w-40"
            label={`Contribution share — ${member.fullName}`}
            value={share}
            valueText={`${share.toFixed(0)}%`}
            tone={flagged ? "warning" : "primary"}
          />
        )
      },
    },
    {
      id: "adjustment",
      header: "Adjustment",
      align: "right",
      hideBelow: "md",
      cell: (member) => {
        const peerFactor = adjustmentFactor(selectedEntry, member, false)
        const selfFactor = adjustmentFactor(selectedEntry, member, true)
        return (
          <span className="font-mono tabular-nums">
            {peerFactor === null ? "—" : peerFactor.toFixed(2)}
            <span className="block text-xs text-muted-foreground">
              self {selfFactor === null ? "—" : selfFactor.toFixed(2)}
            </span>
          </span>
        )
      },
    },
    {
      id: "standing",
      header: "Standing",
      cell: (member) => {
        const flagged =
          selectedEntry?.freeRiders.find((signal) => signal.studentId === member.studentId)
            ?.flagged ?? false
        return flagged ? (
          <StatusPill status="flagged" label="Free-rider signal" dot />
        ) : (
          <StatusPill status="active" label="Contributing" dot />
        )
      },
    },
  ]

  if (suggestions) {
    memberColumns.push({
      id: "suggested",
      header: "Suggested grade",
      align: "right",
      hideBelow: "lg",
      cell: (member) => {
        const suggestion = suggestions.find((row) => row.studentId === member.studentId)
        if (!suggestion) return <span className="text-muted-foreground">—</span>
        return (
          <span className="font-mono tabular-nums">
            {suggestion.individualGrade.toFixed(2)}
            <span className="block text-xs text-muted-foreground">
              self {suggestion.withSelf.individualGrade.toFixed(2)}
            </span>
          </span>
        )
      },
    })
  }

  const pairGroups = groupPairsByEvaluator(selectedEntry?.peerEvaluationPairs ?? [])
  const contributionEvents = selectedEntry?.contributionEvidence.events ?? []
  const contributionTotal = contributionEvents.reduce((total, event) => total + event.weight, 0)
  const attributedEvents = contributionEvents.filter((event) => event.studentId !== null).length

  const milestoneItems: TimelineItem[] = selectedMilestones.map((milestone) => ({
    id: milestone.id,
    title: (
      <span className="flex flex-wrap items-center gap-2">
        {milestone.title}
        <StatusPill
          status={MILESTONE_STATE_TO_STATUS[milestone.status]}
          label={MILESTONE_STATE_LABEL[milestone.status]}
          dot
        />
        <GroupMilestoneActions milestone={milestone} />
      </span>
    ),
    description: milestone.description ?? undefined,
    meta: `Weight ${trimNumber(milestone.weight)} · due ${formatDate(milestone.dueDate)} · ${
      milestone.completedAt ? `completed ${formatDateTime(milestone.completedAt)}` : "not completed"
    }`,
    tone: MILESTONE_STATE_TO_STATUS[milestone.status],
  }))

  const contributionItems: TimelineItem[] = contributionEvents.map((event) => {
    const member = selectedGroup?.members.find((row) => row.studentId === event.studentId)
    return {
      id: event.id,
      title: (
        <span className="flex flex-wrap items-center gap-2">
          {event.summary ?? contributionLabel(event.type)}
          <StatusPill
            status={event.weight < 1 ? "needs-review" : "active"}
            label={contributionLabel(event.type)}
          />
        </span>
      ),
      description: event.studentId
        ? `${member?.fullName ?? event.studentId} · weight ${trimNumber(event.weight)}`
        : `Unattributed · weight ${trimNumber(event.weight)}`,
      meta: formatDateTime(event.occurredAt),
      tone: event.weight < 1 ? "needs-review" : "active",
    }
  })

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          eyebrow={
            selectedOffering
              ? `${selectedOffering.courseCode} · ${selectedOffering.className} · ${selectedOffering.term} ${selectedOffering.academicYear}`
              : undefined
          }
          title="Groups"
          description="Teams, peer evaluation, contribution evidence, and milestones. Contribution signals are evidence only, never a grade."
          actions={
            <>
              <GroupsOfferingPicker
                offerings={offerings}
                selectedOfferingId={selectedOffering?.id ?? null}
              />
              {selectedOffering && (
                <Link href="#formation" className={buttonVariants({ size: "sm" })}>
                  <Wand2 className="size-4" aria-hidden="true" />
                  Form teams
                </Link>
              )}
            </>
          }
        />

        {selectedOffering === null ? (
          <SectionCard title="No offerings">
            <EmptyState
              icon={UsersRound}
              title="No course offerings yet"
              description="Groups belong to a course offering. Create one under Offerings before forming teams."
            />
          </SectionCard>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Teams"
                value={String(groups.length)}
                hint={`${formingCount} still forming`}
                icon={UsersRound}
              />
              <StatCard
                label="Members placed"
                value={String(membersPlaced)}
                hint={`${roster.length} enrolled in total`}
                icon={Users}
              />
              <StatCard
                label="Free-rider signals"
                value={String(flaggedFreeRiders)}
                hint="Low peer ratings. Contribution evidence alone never flags a member."
                icon={ShieldAlert}
              />
              <StatCard
                label="Unassigned"
                value={String(unassigned.length)}
                hint="Enrolled but not placed in a team"
                icon={UserRoundPlus}
              />
            </div>

            {requestedAssessmentId !== undefined && (
              <Callout
                tone="info"
                titleAs="h2"
                title="Showing one project assessment's teams"
                bodyClassName="text-muted-foreground"
              >
                {projectAssessments.find((assessment) => assessment.id === requestedAssessmentId)
                  ?.title ?? "Linked assessment"}{" "}
                — {groups.length} team{groups.length === 1 ? "" : "s"} linked.{" "}
                <Link
                  href={{ pathname: "/teacher/groups", query: { offeringId: selectedOffering.id } }}
                  className="underline underline-offset-4"
                >
                  Show every team
                </Link>
              </Callout>
            )}

            <SectionCard
              title="Teams"
              description={`Contribution is measured from commit, pull-request and review evidence, plus the CATME peer round. ${teamsAwaitingEvaluation.length} team${
                teamsAwaitingEvaluation.length === 1 ? " has" : "s have"
              } not started peer evaluation.`}
            >
              <DataTable
                caption="Project teams"
                columns={teamColumns}
                rows={groups}
                getRowId={(group) => group.id}
                rowActions={(group) => (
                  <Link
                    href={{
                      pathname: "/teacher/groups",
                      query: { offeringId: selectedOffering.id, groupId: group.id },
                    }}
                    aria-current={selectedGroup?.id === group.id ? "true" : undefined}
                    className={buttonVariants({
                      variant: selectedGroup?.id === group.id ? "default" : "outline",
                      size: "xs",
                    })}
                  >
                    {selectedGroup?.id === group.id ? "Selected" : "View"}
                  </Link>
                )}
                empty={
                  <EmptyState
                    icon={UsersRound}
                    title="No teams yet"
                    description="Form groups from the roster to start a project round."
                  />
                }
              />
            </SectionCard>

            {selectedGroup === null ? (
              <SectionCard title="Team detail">
                <EmptyState
                  icon={UsersRound}
                  title="Select a team"
                  description="Form a team first; its members, peer round, milestones and contribution evidence appear here."
                />
              </SectionCard>
            ) : (
              <SectionCard
                title={`Team detail — ${selectedGroup.name}`}
                description={`${selectedGroup.assessmentTitle ? `Project: ${selectedGroup.assessmentTitle} · ` : ""}${selectedGroup.projectTitle ?? "No project title"} · ${selectedGroup.memberCount} members · milestones ${selectedGroup.milestoneProgress.completed}/${selectedGroup.milestoneProgress.total}`}
                action={<StatusPill status={GROUP_STATE_TO_STATUS[selectedGroup.status]} dot />}
              >
                <PageTabs
                  items={[
                    { value: "members", label: "Members", count: selectedGroup.memberCount },
                    {
                      value: "peer",
                      label: "Peer evaluation",
                      count: selectedEntry?.peerEvaluationPairs.length ?? 0,
                    },
                    { value: "milestones", label: "Milestones", count: selectedMilestones.length },
                    {
                      value: "contributions",
                      label: "Contributions",
                      count: contributionEvents.length,
                    },
                  ]}
                  label={`${selectedGroup.name} sections`}
                >
                  <PageTabPanel value="members" className="space-y-4">
                    <DataTable
                      caption={`Members of ${selectedGroup.name}`}
                      columns={memberColumns}
                      rows={selectedGroup.members}
                      getRowId={(member) => member.studentId}
                      empty={
                        <EmptyState
                          title="This team has no members"
                          description="Place students from the roster, or let the formation run balance the teams."
                        />
                      }
                    />
                    <Callout
                      tone="info"
                      titleAs="h3"
                      title="Contribution share is secondary evidence"
                      bodyClassName="text-muted-foreground"
                    >
                      {selectedEntry?.contributionEvidence.notice ??
                        "Contribution metrics are secondary evidence only and must never be the sole basis for a grade."}{" "}
                      A share is a member&rsquo;s portion of the group&rsquo;s recorded weight — it
                      is not a baseline, and it never sets a free-rider flag on its own.
                    </Callout>
                  </PageTabPanel>

                  <PageTabPanel value="peer" className="space-y-6">
                    <section aria-labelledby="peer-matrix">
                      <h3 id="peer-matrix" className="text-sm font-medium">
                        Ratings received, per evaluator
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Visible to you as the instructor, so you can spot collusion and free-riding.
                        The anonymity promise is student-to-student: a teammate never sees who rated
                        them. Every rating uses the five CATME dimensions on a 1–5 scale.
                      </p>
                      <div className="mt-4">
                        {pairGroups.length === 0 ? (
                          <EmptyState
                            icon={Users}
                            title="No peer evaluations yet"
                            description={`${selectedGroup.memberCount} members, ${selectedGroup.memberCount * selectedGroup.memberCount} ratings expected including self-evaluations. Nobody has opened the form.`}
                          />
                        ) : (
                          <ul className="space-y-4">
                            {pairGroups.map((entry) => (
                              <li
                                key={entry.evaluatorId}
                                className="rounded-lg border border-border p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <h4 className="text-sm font-medium">{entry.evaluatorName}</h4>
                                  <span className="text-xs text-muted-foreground">
                                    {
                                      entry.pairs.filter((pair) => pair.status === "SUBMITTED")
                                        .length
                                    }{" "}
                                    of {entry.pairs.length} submitted
                                  </span>
                                </div>
                                <ul className="mt-3 space-y-3">
                                  {entry.pairs.map((pair) => (
                                    <li key={`${pair.evaluatorId}-${pair.evaluateeId}`}>
                                      <PairRow pair={pair} />
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </section>

                    <section aria-labelledby="peer-missing">
                      <h3 id="peer-missing" className="text-sm font-medium">
                        Teams yet to start the round
                      </h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Nobody in these teams has submitted a peer evaluation.
                      </p>
                      <div className="mt-3">
                        {teamsAwaitingEvaluation.length === 0 ? (
                          <EmptyState
                            title="Every team has started evaluating"
                            description="All teams with more than one member have at least one submitted rating."
                          />
                        ) : (
                          <div className="space-y-3">
                            {teamsAwaitingEvaluation.map((group) => (
                              <EmptyState
                                key={group.id}
                                icon={Users}
                                title={`No peer evaluations yet — ${group.name}`}
                                description={`${group.memberCount} members, ${group.memberCount * group.memberCount} ratings expected including self-evaluations.`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </PageTabPanel>

                  <PageTabPanel value="milestones" className="space-y-4">
                    {milestoneItems.length === 0 ? (
                      <EmptyState
                        title="No milestones planned"
                        description="Add a milestone so contribution and progress can be tracked against it."
                      />
                    ) : (
                      <Timeline items={milestoneItems} />
                    )}
                    <GroupMilestoneForm groupId={selectedGroup.id} />
                  </PageTabPanel>

                  <PageTabPanel value="contributions" className="space-y-4">
                    <Callout
                      tone="warning"
                      titleAs="h3"
                      title="Evidence, never a grade"
                      bodyClassName="text-muted-foreground"
                    >
                      {selectedEntry?.contributionEvidence.notice ??
                        "Contribution metrics are secondary evidence only and must never be the sole basis for a grade."}
                    </Callout>
                    {contributionItems.length === 0 ? (
                      <EmptyState
                        title="No contribution evidence"
                        description="Commits, pull requests and reviews appear here once they are recorded."
                      />
                    ) : (
                      <>
                        <Timeline items={contributionItems} />
                        <p className="text-xs text-muted-foreground">
                          {contributionEvents.length} contribution event
                          {contributionEvents.length === 1 ? "" : "s"} ({attributedEvents}{" "}
                          attributed), total weight {contributionTotal.toFixed(2)}. A weight below 1
                          marks lighter-than-expected evidence.
                        </p>
                      </>
                    )}
                    <GroupContributionForm
                      key={selectedGroup.id}
                      groupId={selectedGroup.id}
                      members={selectedGroup.members.map((member) => ({
                        studentId: member.studentId,
                        fullName: member.fullName,
                      }))}
                    />
                  </PageTabPanel>
                </PageTabs>
              </SectionCard>
            )}

            <div id="formation">
              <SectionCard
                title="Formation"
                description="Who is still waiting for a team, then the manual and automatic ways to place them."
              >
                <div className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="unassigned">
                      <h3 id="unassigned" className="text-sm font-medium">
                        Students not in a team
                      </h3>
                      <div className="mt-3">
                        {unassigned.length === 0 ? (
                          <EmptyState
                            icon={UsersRound}
                            title="Everyone is placed"
                            description="Every active student in this offering belongs to a team."
                          />
                        ) : (
                          <ul className="divide-y divide-border rounded-lg border border-border">
                            {unassigned.map((student) => (
                              <li
                                key={student.studentId}
                                className="flex flex-wrap items-center justify-between gap-2 p-3"
                              >
                                <div className="min-w-0">
                                  <TruncatedText className="font-medium" title={student.fullName}>
                                    {student.fullName}
                                  </TruncatedText>
                                  <p className="text-xs text-muted-foreground">
                                    {student.registerNumber}
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
                      <div className="mt-3 space-y-3">
                        {groups.filter((group) => group.status === "FORMING").length === 0 ? (
                          <EmptyState
                            title="No team is still forming"
                            description="Every group has left the FORMING state."
                          />
                        ) : (
                          groups
                            .filter((group) => group.status === "FORMING")
                            .map((group) => (
                              <EmptyState
                                key={group.id}
                                icon={Users}
                                title={`${group.name} has ${group.memberCount} member${
                                  group.memberCount === 1 ? "" : "s"
                                }`}
                                description={`${group.projectTitle ?? "No project title"}. A team can exist while empty so it can be balanced automatically.`}
                              />
                            ))
                        )}
                      </div>
                    </section>
                  </div>

                  <GroupFormationPanel
                    key={selectedOffering.id}
                    offeringId={selectedOffering.id}
                    roster={roster}
                    projectAssessments={projectAssessments}
                  />
                </div>
              </SectionCard>
            </div>

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
                  value={`${submittedRatings} of ${expectedRatings}`}
                  hint="Only submitted ratings count; a draft is excluded."
                />
                <MetricRow
                  label="Disclosure threshold"
                  value={String(MIN_RATERS_FOR_DISCLOSURE)}
                  hint="A student never sees their received aggregate until this many teammates have submitted."
                />
                <MetricRow
                  label="Grade suggestions"
                  value={
                    suggestions === null
                      ? "Not computed"
                      : `${suggestionCount} student${suggestionCount === 1 ? "" : "s"}`
                  }
                  hint="A group grade is required before per-student factors become suggestions. Nothing is published here."
                />
                <MetricRow
                  label="Adjustment factors"
                  value="Suggestions only"
                  hint="A factor scales the shared group grade; publishing stays a teacher action in the gradebook."
                />
              </div>
              <div className="mt-4">
                <GroupGradeSuggestionForm
                  offeringId={selectedOffering.id}
                  selectedGroupId={selectedGroup?.id ?? null}
                  groupGrade={groupGrade ?? null}
                />
              </div>
            </SectionCard>
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}
