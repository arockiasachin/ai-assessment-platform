import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  codeEvalErrorResponse,
  listStudentCodeTasks,
  listStudentRuns,
  submitCodeForStudent,
} from "@/lib/code-eval"
import { codeSubmissionRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

/**
 * `GET /api/student/code-submissions` — the student's own enrolled code tasks
 * with their submission budget. With `?assessmentId=` it also returns their own
 * runs for that task.
 *
 * `POST` — submit source code. Enrollment, deadline, and the submission cap are
 * enforced server-side; the run happens in the Docker sandbox and the result is
 * persisted as evidence (never a published grade).
 */
export async function GET(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const assessmentId = new URL(request.url).searchParams.get("assessmentId")

  try {
    if (assessmentId) {
      const runs = await listStudentRuns(auth.user, assessmentId)
      return NextResponse.json({ success: true, runs })
    }
    const tasks = await listStudentCodeTasks(auth.user)
    return NextResponse.json({ success: true, tasks })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, codeSubmissionRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const run = await submitCodeForStudent(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message:
        "Submission evaluated. Results are evidence for your teacher, not a published grade.",
      run,
    })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
