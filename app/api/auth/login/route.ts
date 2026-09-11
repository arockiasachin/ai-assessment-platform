import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import { jsonError, parseJsonBody } from "@/lib/api"
import { createSessionResponse } from "@/lib/auth"
import { loginRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

function toAuthRole(dbRole: "ADMIN" | "TEACHER" | "STUDENT") {
  if (dbRole === "ADMIN") return "admin" as const
  if (dbRole === "TEACHER") return "teacher" as const
  return "student" as const
}

/**
 * Every login is checked against the database and a bcrypt password hash. There
 * is no hardcoded credential path: a client cannot obtain a session by asserting
 * a role in the request body.
 */
export async function POST(request: Request) {
  try {
    const parsed = await parseJsonBody(request, loginRequestSchema)
    if (!parsed.ok) return parsed.response

    const normalizedIdentifier = parsed.data.email.trim().toLowerCase()

    const user = await prisma.user.findUnique({ where: { email: normalizedIdentifier } })
    if (!user) {
      return jsonError("Invalid credentials.", 401)
    }

    const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!validPassword) {
      return jsonError("Invalid credentials.", 401)
    }

    return createSessionResponse({
      id: user.id,
      email: user.email,
      role: toAuthRole(user.role),
    })
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json({ success: false, message: "Server error." }, { status: 500 })
  }
}
