import { NextResponse } from "next/server"

import { jsonError, parseJsonBody } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import { quizImportRequestSchema } from "@/lib/contracts"
import { createQuizFromImportForSessionUser } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  const auth = await requireRole("teacher")
  if (!auth.authorized) return auth.response

  const parsed = await parseJsonBody(request, quizImportRequestSchema)
  if (!parsed.ok) return parsed.response

  try {
    const assessment = await createQuizFromImportForSessionUser(parsed.data, auth.user)
    return NextResponse.json({
      success: true,
      message: "Quiz created successfully.",
      assessment,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create quiz."
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400
    return jsonError(message, status)
  }
}
