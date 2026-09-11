import { NextResponse } from "next/server"

import { parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  listRubricsForTeacher,
  rubricErrorResponse,
  rubricUpsertRequestSchema,
  upsertRubricForTeacher,
} from "@/lib/rubric-grading"

/** `GET /api/teacher/rubrics` — the teacher's assessments and their rubrics. */
export async function GET() {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  try {
    const assessments = await listRubricsForTeacher(auth.user)
    return NextResponse.json({ success: true, assessments })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}

/** `POST /api/teacher/rubrics` — create or replace a rubric for an owned assessment. */
export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, rubricUpsertRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const result = await upsertRubricForTeacher(auth.user, parsed.data)
    return NextResponse.json({
      success: true,
      message: "Rubric saved.",
      rubric: result.rubric,
    })
  } catch (error) {
    return rubricErrorResponse(error)
  }
}
