import type {
  ContributionEvidenceValue,
  GroupAnalysisResponse,
  GroupMemberResponse,
  GroupSummary,
  MilestoneResponse,
  MyEvaluationResponse,
  PeerEvaluationPair,
  TeammateResponse,
} from "@/lib/contracts/groups"
import type {
  ContributionEvent,
  Group,
  GroupMember,
  Milestone,
  StudentProfile,
} from "@/lib/generated/prisma/client"

import type { GroupAnalysis, SuggestedIndividualGrade } from "./analysis"
import {
  CONTRIBUTION_EVIDENCE_DISCLAIMER,
  summarizeContributions,
  type ContributionSignalInput,
} from "./contribution"
import type { MilestoneProgress } from "./milestones"

/**
 * Serializers for the groups pod. They keep raw Prisma rows from leaking the
 * wrong fields (e.g. password hashes, evaluator identities) and are the single
 * place the contribution "evidence, not a grade" disclaimer is attached.
 */

export type GroupMemberWithStudent = GroupMember & { student: StudentProfile }

export function serializeGroupMember(member: GroupMemberWithStudent): GroupMemberResponse {
  return {
    id: member.id,
    studentId: member.studentId,
    fullName: member.student.fullName,
    registerNumber: member.student.registerNumber,
    role: member.role ?? null,
    adjustmentFactor: member.adjustmentFactor ?? null,
    selfAdjustmentFactor: member.selfAdjustmentFactor ?? null,
    joinedAt: member.joinedAt.toISOString(),
    leftAt: member.leftAt ? member.leftAt.toISOString() : null,
  }
}

export function serializeMilestone(milestone: Milestone): MilestoneResponse {
  return {
    id: milestone.id,
    groupId: milestone.groupId,
    title: milestone.title,
    description: milestone.description ?? null,
    status: milestone.status,
    weight: milestone.weight,
    dueDate: milestone.dueDate ? milestone.dueDate.toISOString() : null,
    completedAt: milestone.completedAt ? milestone.completedAt.toISOString() : null,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
  }
}

export type GroupWithMembers = Group & { members: GroupMemberWithStudent[] }

export function serializeGroupSummary(
  group: GroupWithMembers,
  progress: MilestoneProgress,
  flags: { behind: boolean; lopsided: boolean } = { behind: progress.behind, lopsided: false },
): GroupSummary {
  const activeMembers = group.members.filter((member) => member.leftAt === null)
  return {
    id: group.id,
    offeringId: group.offeringId,
    name: group.name,
    projectTitle: group.projectTitle ?? null,
    status: group.status,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    memberCount: activeMembers.length,
    members: activeMembers.map(serializeGroupMember),
    milestoneProgress: progress,
    behind: flags.behind,
    lopsided: flags.lopsided,
  }
}

export type ContributionEventRow = ContributionEvent

/**
 * Contribution events are always returned as evidence. `gradeBasis: false` and
 * the notice are part of the payload, not just a comment, so a client cannot
 * present them as a grade without contradicting the response it received.
 */
export function buildContributionEvidence(
  groupId: string,
  events: readonly ContributionEventRow[],
): ContributionEvidenceValue {
  const signalInput: ContributionSignalInput[] = events.map((event) => ({
    studentId: event.studentId,
    type: event.type,
    weight: event.weight,
    occurredAt: event.occurredAt,
  }))
  return {
    ...CONTRIBUTION_EVIDENCE_DISCLAIMER,
    summaries: summarizeContributions(signalInput),
    events: events.map((event) => ({
      id: event.id,
      groupId,
      studentId: event.studentId,
      type: event.type,
      source: event.source ?? null,
      externalId: event.externalId ?? null,
      summary: event.summary ?? null,
      weight: event.weight,
      occurredAt: event.occurredAt.toISOString(),
    })),
  }
}

export function serializeTeammate(
  student: Pick<StudentProfile, "id" | "fullName" | "registerNumber">,
  selfId: string,
): TeammateResponse {
  return {
    studentId: student.id,
    fullName: student.fullName,
    registerNumber: student.registerNumber,
    isSelf: student.id === selfId,
  }
}

export type PeerEvaluationRowForStudent = {
  evaluateeId: string
  status: "DRAFT" | "SUBMITTED"
  overallScore: number | null
  dimensions: unknown
  comments: string | null
  submittedAt: Date | null
}

function readRatings(dimensions: unknown): MyEvaluationResponse["ratings"] {
  if (!dimensions || typeof dimensions !== "object") return null
  const raw = dimensions as { ratings?: unknown }
  if (!raw.ratings || typeof raw.ratings !== "object") return null
  const ratings = raw.ratings as Record<string, unknown>
  const keys = [
    "contributing",
    "interacting",
    "keepingOnTrack",
    "expectingQuality",
    "knowledgeSkillsAbilities",
  ] as const
  const parsed = {} as Record<(typeof keys)[number], number>
  for (const key of keys) {
    const value = ratings[key]
    if (typeof value !== "number") return null
    parsed[key] = value
  }
  return parsed
}

export function serializeMyEvaluation(
  evaluation: PeerEvaluationRowForStudent,
): MyEvaluationResponse {
  return {
    evaluateeId: evaluation.evaluateeId,
    status: evaluation.status,
    overallScore: evaluation.overallScore ?? null,
    ratings: readRatings(evaluation.dimensions),
    comments: evaluation.comments ?? null,
    submittedAt: evaluation.submittedAt ? evaluation.submittedAt.toISOString() : null,
  }
}

export type PeerEvaluationPairRow = {
  evaluatorId: string
  evaluateeId: string
  status: "DRAFT" | "SUBMITTED"
  /** The raw `PeerEvaluation.dimensions` column; parsed by `readRatings`. */
  dimensions: unknown
  submittedAt: Date | null
}

/**
 * Project the instructor-only evaluator↔evaluatee matrix (D6).
 *
 * A draft's values stay hidden (`null`) until it is submitted — the same boundary
 * the student UI draws. A name that is not on the group's roster falls back to
 * the id rather than a fabricated label. This shape is teacher-only: the student
 * wrapper never calls it.
 */
export function serializePeerEvaluationPairs(
  rows: readonly PeerEvaluationPairRow[],
  namesById: ReadonlyMap<string, string>,
): PeerEvaluationPair[] {
  return rows.map((row) => {
    const isSubmitted = row.status === "SUBMITTED"
    return {
      evaluatorId: row.evaluatorId,
      evaluatorName: namesById.get(row.evaluatorId) ?? row.evaluatorId,
      evaluateeId: row.evaluateeId,
      evaluateeName: namesById.get(row.evaluateeId) ?? row.evaluateeId,
      status: isSubmitted ? "SUBMITTED" : "DRAFT",
      ratings: isSubmitted ? readRatings(row.dimensions) : null,
      submittedAt: isSubmitted && row.submittedAt ? row.submittedAt.toISOString() : null,
    }
  })
}

/**
 * Project the pure `GroupAnalysis` onto the API response. Completion is taken
 * from the free-rider signals (each carries the member's submitted/expected
 * evaluation counts), and the contribution block is the evidence-stamped payload
 * — never a grade. `peerEvaluationPairs` is the instructor-only D6 matrix.
 */
export function serializeGroupAnalysis(
  analysis: GroupAnalysis,
  evidence: ContributionEvidenceValue,
  suggestedIndividualGrades: SuggestedIndividualGrade[] | null,
  peerEvaluationPairs: PeerEvaluationPair[],
): GroupAnalysisResponse {
  return {
    groupId: analysis.groupId,
    memberIds: analysis.memberIds,
    withoutSelf: analysis.withoutSelf,
    withSelf: analysis.withSelf,
    freeRiders: analysis.freeRiders,
    milestoneProgress: analysis.milestoneProgress,
    submittedEvaluationCount: analysis.submittedEvaluationCount,
    completion: analysis.freeRiders.map((signal) => ({
      studentId: signal.studentId,
      submittedEvaluations: signal.submittedEvaluations,
      expectedEvaluations: signal.expectedEvaluations,
      completionRate: signal.completionRate,
    })),
    contributionEvidence: evidence,
    peerEvaluationPairs,
    suggestedIndividualGrades,
  }
}
