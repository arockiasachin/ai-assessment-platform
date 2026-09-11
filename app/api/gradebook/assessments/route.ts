import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth"
import { createAssessmentForSessionUser } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
  }

  if (user.role !== "teacher") {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const title = String(body.title ?? "").trim()
    const courseId = String(body.courseId ?? "")
    const typeRaw = String(body.type ?? "")
    const date = String(body.date ?? "")
    const maxMarks = Number(body.maxMarks)

    if (!title || !courseId || !date || !Number.isFinite(maxMarks) || maxMarks <= 0) {
      return NextResponse.json(
        { success: false, message: "Invalid assessment payload." },
        { status: 400 },
      )
    }

    if (typeRaw !== "Quiz" && typeRaw !== "Assignment") {
      return NextResponse.json(
        { success: false, message: "Invalid assessment type." },
        { status: 400 },
      )
    }

    const assessment = await createAssessmentForSessionUser({
      title,
      courseId,
      type: typeRaw,
      date,
      maxMarks,
    })

    return NextResponse.json({ success: true, assessment })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create assessment."
    const status = message === "Forbidden" ? 403 : message === "Unauthorized" ? 401 : 400
    return NextResponse.json({ success: false, message }, { status })
  }
}
