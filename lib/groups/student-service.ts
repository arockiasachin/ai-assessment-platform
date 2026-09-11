import {
  peerEvaluationSubmitRequestSchema,
  type PeerEvaluationSubmitResponse,
  type StudentPeerEvaluationGroup,
} from "@/lib/contracts/groups"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { analyzeGroup } from "./analysis"
import { resolveStudentProfile } from "./authz"
import { GroupError, GroupValidationError } from "./errors"
import { overallFromRatings, type PeerEvaluationDimensionKey } from "./dimensions"
import { serializeMyEvaluation, serializeTeammate } from "./serialize"
import { readStoredRatings, toStoredDimensions } from "./storage"

/**
 * Student-facing peer evaluation.
 *
 * CONFIDENTIALITY is the defining constraint of this module:
 *
 *  - A student only ever reads evaluations they wrote.
 *  - Received results are an anonymous aggregate over dimension averages. There
 *    is no evaluator id, name, or received free-text comment anywhere in the
 *    payload.
 *  - The aggregate is withheld until at least `MIN_RATERS_FOR_DISCLOSURE`
 *    distinct teammates have submitted, so a two- or three-person team cannot
 *    use the numbers to reconstruct who said what.
 *  - Nothing here can read another group: every query is scoped to a group the
 *    signed-in student is an active member of.
 */

export const MIN_RATERS_FOR_DISCLOSURE = 3

function round(value: number, digits = 4): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function getPeerEvaluationWorkspaceForStudent(
  user: AuthUser,
): Promise<StudentPeerEvaluationGroup[]> {
  const student = await resolveStudentProfile(user)

  const memberships = await prisma.groupMember.findMany({
    where: { studentId: student.studentId, leftAt: null },
    select: {
      group: {
        select: {
          id: true,
          offeringId: true,
          name: true,
          projectTitle: true,
          offering: { select: { course: { select: { code: true, name: true } } } },
          members: {
            where: { leftAt: null },
            select: {
              student: { select: { id: true, fullName: true, registerNumber: true } },
            },
          },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  })

  const groupIds = memberships.map((membership) => membership.group.id)
  const evaluations = groupIds.length
    ? await prisma.peerEvaluation.findMany({
        where: { groupId: { in: groupIds } },
        select: {
          groupId: true,
          evaluatorId: true,
          evaluateeId: true,
          status: true,
          dimensions: true,
          comments: true,
          overallScore: true,
          submittedAt: true,
        },
      })
    : []

  return memberships.map((membership) => {
    const group = membership.group
    const activeMembers = group.members.map((member) => member.student)
    const activeMemberIds = new Set(activeMembers.map((member) => member.id))
    const groupEvaluations = evaluations.filter((evaluation) => evaluation.groupId === group.id)
    const mine = groupEvaluations.filter(
      (evaluation) => evaluation.evaluatorId === student.studentId,
    )
    const submittedMine = mine.filter((evaluation) => evaluation.status === "SUBMITTED")

    const receivedRatings = groupEvaluations
      .filter(
        (evaluation) =>
          evaluation.evaluateeId === student.studentId &&
          evaluation.evaluatorId !== student.studentId &&
          evaluation.status === "SUBMITTED",
      )
      .map((evaluation) => readStoredRatings(evaluation.dimensions))
      .filter((ratings): ratings is NonNullable<typeof ratings> => ratings !== null)

    const distinctRaters = receivedRatings.length
    const minRatersRequired = MIN_RATERS_FOR_DISCLOSURE

    let received: StudentPeerEvaluationGroup["received"]
    if (distinctRaters >= minRatersRequired) {
      const keys: PeerEvaluationDimensionKey[] = [
        "contributing",
        "interacting",
        "keepingOnTrack",
        "expectingQuality",
        "knowledgeSkillsAbilities",
      ]
      const dimensionAverages = {} as Record<PeerEvaluationDimensionKey, number>
      for (const key of keys) {
        const sum = receivedRatings.reduce((total, ratings) => total + ratings[key], 0)
        dimensionAverages[key] = round(sum / distinctRaters)
      }
      const overallAverage = round(
        keys.reduce((sum, key) => sum + dimensionAverages[key], 0) / keys.length,
      )
      received = {
        withheld: false,
        dimensionAverages,
        overallAverage,
        ratingCount: distinctRaters,
        minRatersRequired,
      }
    } else {
      received = {
        withheld: true,
        ratingCount: distinctRaters,
        minRatersRequired,
        reason:
          distinctRaters < minRatersRequired
            ? `Results are shown only after at least ${minRatersRequired} teammates have submitted, so individual ratings stay confidential.`
            : "Results are not available yet.",
      }
    }

    return {
      groupId: group.id,
      groupName: group.name,
      projectTitle: group.projectTitle ?? null,
      offeringId: group.offeringId,
      courseCode: group.offering.course.code,
      courseName: group.offering.course.name,
      teammates: activeMembers.map((member) => serializeTeammate(member, student.studentId)),
      myEvaluations: mine.map(serializeMyEvaluation),
      selfEvaluationSubmitted: submittedMine.some(
        (evaluation) => evaluation.evaluateeId === student.studentId,
      ),
      expectedEvaluations: activeMemberIds.size,
      submittedEvaluations: submittedMine.length,
      received,
    }
  })
}

/**
 * Save draft or submit a student's evaluations for one group. The student must
 * be an active member, and every active member (including the student) must be
 * rated exactly once.
 */
export async function submitPeerEvaluationsForStudent(
  user: AuthUser,
  input: unknown,
): Promise<PeerEvaluationSubmitResponse> {
  const request = peerEvaluationSubmitRequestSchema.parse(input)
  const student = await resolveStudentProfile(user)

  const group = await prisma.group.findFirst({
    where: {
      id: request.groupId,
      members: { some: { studentId: student.studentId, leftAt: null } },
    },
    select: {
      id: true,
      members: { where: { leftAt: null }, select: { studentId: true } },
    },
  })
  if (!group) throw new GroupError(403, "You are not an active member of this group.")

  const memberIds = new Set(group.members.map((member) => member.studentId))
  const provided = new Map<string, (typeof request.evaluations)[number]>()
  for (const evaluation of request.evaluations) {
    if (!memberIds.has(evaluation.evaluateeId)) {
      throw new GroupValidationError("You can only evaluate members of your own group.")
    }
    if (provided.has(evaluation.evaluateeId)) {
      throw new GroupValidationError("Each teammate may be rated only once per submission.")
    }
    provided.set(evaluation.evaluateeId, evaluation)
  }
  if (!provided.has(student.studentId)) {
    throw new GroupValidationError("A self-evaluation is required.")
  }
  const missing = [...memberIds].filter((memberId) => !provided.has(memberId))
  if (missing.length > 0) {
    throw new GroupValidationError(
      `Every teammate must be rated. Missing: ${missing.length} teammate(s).`,
    )
  }

  const status = request.submit ? "SUBMITTED" : "DRAFT"
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    for (const evaluation of request.evaluations) {
      const overallScore = overallFromRatings(evaluation.ratings)
      await tx.peerEvaluation.upsert({
        where: {
          groupId_evaluatorId_evaluateeId: {
            groupId: group.id,
            evaluatorId: student.studentId,
            evaluateeId: evaluation.evaluateeId,
          },
        },
        create: {
          groupId: group.id,
          evaluatorId: student.studentId,
          evaluateeId: evaluation.evaluateeId,
          status,
          dimensions: toStoredDimensions(evaluation.ratings),
          overallScore,
          comments: evaluation.comments ?? null,
          submittedAt: request.submit ? now : null,
        },
        update: {
          status,
          dimensions: toStoredDimensions(evaluation.ratings),
          overallScore,
          comments: evaluation.comments ?? null,
          submittedAt: request.submit ? now : null,
        },
      })
    }
    await tx.auditLog.create({
      data: {
        entityType: "Group",
        entityId: group.id,
        action: request.submit ? "peer_evaluation.submitted" : "peer_evaluation.draft_saved",
        actorId: user.id,
        actorRole: user.role,
        after: { evaluationCount: request.evaluations.length, status },
      },
    })
  })

  await recomputeAdjustmentFactorsForGroup(group.id)

  return {
    success: true,
    message: request.submit
      ? "Peer evaluations submitted. Your individual ratings stay confidential."
      : "Draft saved. You can change it until you submit.",
    groupId: group.id,
    submitted: request.evaluations.length,
    status,
  }
}

/**
 * Recompute and persist both adjustment factors for every member of a group from
 * the current SUBMITTED evaluations. Called after a peer-evaluation submission so
 * `GroupMember.adjustmentFactor` (peer-only, the CATME convention) and
 * `selfAdjustmentFactor` (self-ratings included) stay current.
 */
export async function recomputeAdjustmentFactorsForGroup(groupId: string): Promise<void> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      members: { select: { id: true, studentId: true } },
      peerEvaluations: {
        where: { status: "SUBMITTED" },
        select: { evaluatorId: true, evaluateeId: true, status: true, dimensions: true },
      },
    },
  })
  if (!group || group.members.length === 0) return

  const memberIds = group.members.map((member) => member.studentId)
  const rows = group.peerEvaluations.flatMap((evaluation) => {
    const ratings = readStoredRatings(evaluation.dimensions)
    if (ratings === null) return []
    return [
      {
        evaluatorId: evaluation.evaluatorId,
        evaluateeId: evaluation.evaluateeId,
        status: evaluation.status,
        ratings,
      },
    ]
  })

  const analysis = analyzeGroup({ groupId, memberIds, evaluations: rows })
  const withoutSelf = new Map(analysis.withoutSelf.map((entry) => [entry.studentId, entry]))
  const withSelf = new Map(analysis.withSelf.map((entry) => [entry.studentId, entry]))

  await prisma.$transaction(
    group.members.map((member) =>
      prisma.groupMember.update({
        where: { id: member.id },
        data: {
          adjustmentFactor: withoutSelf.get(member.studentId)?.adjustmentFactor ?? null,
          selfAdjustmentFactor: withSelf.get(member.studentId)?.adjustmentFactor ?? null,
        },
      }),
    ),
  )
}
