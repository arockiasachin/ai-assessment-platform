import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizAttemptStartRequestSchema } from "@/lib/contracts"
import { quizAttemptErrorResponse, startPracticeAttempt } from "@/lib/quiz-attempts"

export const dynamic = "force-dynamic"

/**
 * `POST /api/student/quiz-attempts/practice` — start or resume a **practice** sitting.
 *
 * Separate from the graded start on purpose. Practice does not consume an attempt, does not
 * consult the retake policy, and never enters the grade pipeline, so routing it through the
 * same endpoint would mean one handler whose behaviour depends on a flag the client controls.
 * Two endpoints make the distinction structural.
 *
 * The one gate practice does have is enforced in the service: it is available only once the
 * deadline has passed or a graded attempt has been submitted, because the start view returns the
 * questions.
 */
export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizAttemptStartRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const attempt = await startPracticeAttempt(auth.user, parsed.data)
    return NextResponse.json({ success: true, attempt, practice: true })
  } catch (error) {
    return quizAttemptErrorResponse(error)
  }
}
