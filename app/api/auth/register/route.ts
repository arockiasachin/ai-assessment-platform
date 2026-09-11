import bcrypt from "bcryptjs"

import { jsonError, parseJsonBody } from "@/lib/api"
import { createSessionResponse } from "@/lib/auth"
import { registerRequestSchema } from "@/lib/contracts"
import { prisma } from "@/lib/prisma"

function toAuthRole(dbRole: "ADMIN" | "TEACHER" | "STUDENT") {
  if (dbRole === "ADMIN") return "admin" as const
  if (dbRole === "TEACHER") return "teacher" as const
  return "student" as const
}

function nameFromEmail(email: string) {
  const raw = email.split("@")[0] ?? "User"
  return raw
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export async function POST(request: Request) {
  try {
    const parsed = await parseJsonBody(request, registerRequestSchema)
    if (!parsed.ok) return parsed.response

    const normalizedEmail = parsed.data.email.trim().toLowerCase()
    const role = parsed.data.role

    if (normalizedEmail === "admin") {
      return jsonError("The admin account is reserved.", 403)
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      return jsonError("User already exists.", 409)
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10)
    const normalizedRole = role === "teacher" ? "TEACHER" : "STUDENT"

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        role: normalizedRole,
      },
    })

    if (normalizedRole === "TEACHER") {
      await prisma.staffProfile.create({
        data: {
          userId: user.id,
          fullName: nameFromEmail(normalizedEmail),
          empId: `EMP-${Date.now()}`,
        },
      })
    } else {
      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          fullName: nameFromEmail(normalizedEmail),
          registerNumber: `REG-${Date.now()}`,
        },
      })
    }

    return createSessionResponse({
      id: user.id,
      email: user.email,
      role: toAuthRole(user.role),
    })
  } catch (error) {
    console.error("Registration error:", error)
    return jsonError("Server error.", 500)
  }
}
