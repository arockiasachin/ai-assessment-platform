import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  codeEvalErrorResponse,
  listSimilarityForTeacher,
  scanCohortSimilarityForTeacher,
} from "@/lib/code-eval"
import { similarityScanRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/**
 * `GET /api/teacher/code-tasks/[assessmentId]/similarity` — stored cohort
 * similarity pairs.
 *
 * `POST` — re-scan the cohort (token shingling / Jaccard) and persist pairs.
 * Flags only; never decides a grade.
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  try {
    const outcome = await listSimilarityForTeacher(auth.user, assessmentId)
    return NextResponse.json(outcome)
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}

export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const { assessmentId } = await context.params
  const parsed = await parseJsonBody(request, similarityScanRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const outcome = await scanCohortSimilarityForTeacher(auth.user, assessmentId, parsed.data)
    return NextResponse.json(outcome)
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
