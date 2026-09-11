import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth"
import { upsertAssessmentGrade } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
  }

  if (user.role !== "teacher" && user.role !== "student") {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const studentId = String(body.studentId ?? "")
    const assessmentId = String(body.assessmentId ?? "")
    const scoreRaw = body.score

    if (!studentId || !assessmentId) {
      return NextResponse.json({ success: false, message: "Missing identifiers." }, { status: 400 })
    }

    const score = scoreRaw === null ? null : Number(scoreRaw)
    if (score !== null && !Number.isFinite(score)) {
      return NextResponse.json({ success: false, message: "Invalid score." }, { status: 400 })
    }

    await upsertAssessmentGrade({ studentId, assessmentId, score })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save mark."
    const status =
      message === "Forbidden"
        ? 403
        : message === "Unauthorized"
          ? 401
          : message === "Assessment not found"
            ? 404
            : 400
    return NextResponse.json({ success: false, message }, { status })
  }
}
