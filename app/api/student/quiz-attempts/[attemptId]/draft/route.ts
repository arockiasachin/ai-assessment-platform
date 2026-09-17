import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizAttemptDraftRequestSchema } from "@/lib/contracts"
import { quizAttemptErrorResponse, saveQuizAttemptDraft } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `PUT /api/student/quiz-attempts/[attemptId]/draft` — autosave the answers of an in-progress
 * sitting.
 *
 * This is the save path the sitting never had. It writes the student's own answers only; it
 * never scores them, never discloses correctness, and is rejected once the attempt is
 * submitted. The rows it writes live in `QuizResponse` and are replaced by the scored rows at
 * submit, so there is one home for an answer rather than a draft store and a final store that
 * could disagree.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizAttemptDraftRequestSchema)
  if (!parsed.ok) return parsed.response

  const { attemptId } = await params
  try {
    const result = await saveQuizAttemptDraft(auth.user, attemptId, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
