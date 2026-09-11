import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  getOfferingAnalysisForTeacher,
  groupsErrorResponse,
  serializeGroupAnalysis,
} from "@/lib/groups"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/groups/analysis?offeringId=` — the instructor dashboard data
 * for every group in one owned offering: adjustment factors both with and without
 * self-ratings, free-rider signals, survey completion, contribution evidence
 * (explicitly not a grade), and milestone progress.
 *
 * `?groupGrade=` (or `?assessmentId=` for a GROUP_PROJECT assessment whose members
 * all carry the same mark) additionally returns per-student grade *suggestions*.
 * Nothing is published here.
 */
export async function GET(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const params = new URL(request.url).searchParams
  const offeringId = params.get("offeringId")
  if (!offeringId) return jsonError("offeringId is required.", 400)

  const assessmentId = params.get("assessmentId") ?? undefined
  const groupGradeParam = params.get("groupGrade")
  let groupGrade: number | undefined
  if (groupGradeParam !== null) {
    const value = Number(groupGradeParam)
    if (!Number.isFinite(value) || value < 0) {
      return jsonError("groupGrade must be a non-negative number.", 400)
    }
    groupGrade = value
  }

  try {
    const result = await getOfferingAnalysisForTeacher(auth.user, {
      offeringId,
      assessmentId,
      groupGrade,
    })
    return NextResponse.json({
      success: true,
      analysis: result.groups.map((entry) =>
        serializeGroupAnalysis(
          entry.analysis,
          entry.contributionEvidence,
          entry.suggestedIndividualGrades,
        ),
      ),
      cohortProgress: result.cohortProgress.map((entry) => ({
        groupId: entry.groupId,
        behind: entry.behind,
        lopsided: entry.lopsided,
        weightedCompletion: entry.progress.weightedCompletion,
      })),
    })
  } catch (error) {
    return groupsErrorResponse(error)
  }
}
