import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"

export async function GET() {
  const auth = await requireRole("teacher", "student")
  if (!auth.authorized) return auth.response

  const payload = await getGradebookPayloadForSessionUser(auth.user)
  return NextResponse.json(payload)
}
