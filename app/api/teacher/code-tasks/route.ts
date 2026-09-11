import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  codeEvalErrorResponse,
  listTeacherCodeTasks,
  upsertCodeTaskForTeacher,
} from "@/lib/code-eval"
import { upsertCodeTaskRequestSchema } from "@/lib/contracts/code-eval"

export const dynamic = "force-dynamic"

/**
 * `GET /api/teacher/code-tasks` — the teacher's own CODE assessments with their
 * code-task and run counts.
 *
 * `POST /api/teacher/code-tasks` — create or replace the code task (language,
 * limits, instructions, starter code, submission cap) on one owned CODE
 * assessment.
 */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const tasks = await listTeacherCodeTasks(auth.user)
    return NextResponse.json({ success: true, tasks })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, upsertCodeTaskRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const task = await upsertCodeTaskForTeacher(auth.user, parsed.data)
    return NextResponse.json({ success: true, message: "Code task saved.", task })
  } catch (error) {
    return codeEvalErrorResponse(error)
  }
}
