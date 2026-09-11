import { NextResponse } from "next/server"

import { createQuizFromImportForSessionUser } from "@/lib/gradebook-db"

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as unknown
    const assessment = await createQuizFromImportForSessionUser(payload)
    return NextResponse.json({
      success: true,
      message: "Quiz created successfully.",
      assessment,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create quiz."
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 400

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status },
    )
  }
}
