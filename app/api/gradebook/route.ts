import { NextResponse } from "next/server"

import { getSessionUser } from "@/lib/auth"
import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"

export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
  }

  if (user.role === "admin") {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 })
  }

  const payload = await getGradebookPayloadForSessionUser()
  return NextResponse.json(payload)
}
