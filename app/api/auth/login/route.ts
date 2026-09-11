import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import { jsonError, parseJsonBody } from "@/lib/api"
import { createSessionResponse } from "@/lib/auth"
import { loginRequestSchema } from "@/lib/contracts"
import {
  clientIpFromHeaders,
  getLoginAttemptThrottle,
  normalizeLoginIdentifier,
} from "@/lib/login-rate-limit"
import { prisma } from "@/lib/prisma"

function toAuthRole(dbRole: "ADMIN" | "TEACHER" | "STUDENT") {
  if (dbRole === "ADMIN") return "admin" as const
  if (dbRole === "TEACHER") return "teacher" as const
  return "student" as const
}

/**
 * Same generic message for a non-existent account and a wrong password, and for
 * a throttled attempt, so the response never reveals whether an account exists.
 */
const INVALID_CREDENTIALS = "Invalid credentials."
const THROTTLED = "Too many login attempts. Please try again later."

/**
 * A bcrypt hash of an unrelated throwaway value, used only to spend the same CPU
 * on an unknown identifier as on a known one. Without it, a missing account
 * returns before bcrypt and the response time reveals account existence.
 */
let dummyPasswordHash: string | null = null
function getDummyPasswordHash(): string {
  if (!dummyPasswordHash) {
    dummyPasswordHash = bcrypt.hashSync("login-throttle-dummy-value", 10)
  }
  return dummyPasswordHash
}

/**
 * Every login is checked against the database and a bcrypt password hash. There
 * is no hardcoded credential path: a client cannot obtain a session by asserting
 * a role in the request body.
 *
 * The throttle is consulted *before* the database lookup, and failed attempts
 * are recorded for unknown accounts too, so a locked response is identical for
 * real and non-existent users. See `lib/login-rate-limit.ts` for the store's
 * per-process limit and eviction policy.
 */
export async function POST(request: Request) {
  try {
    const parsed = await parseJsonBody(request, loginRequestSchema)
    if (!parsed.ok) return parsed.response

    const normalizedIdentifier = normalizeLoginIdentifier(parsed.data.email)
    const clientIp = clientIpFromHeaders(request.headers)
    const throttle = getLoginAttemptThrottle()

    const decision = throttle.check(normalizedIdentifier, clientIp)
    if (decision.limited) {
      const response = jsonError(THROTTLED, 429)
      response.headers.set("Retry-After", String(decision.retryAfterSeconds))
      return response
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedIdentifier } })
    if (!user) {
      // Spend a bcrypt comparison so timing does not distinguish this path.
      await bcrypt.compare(parsed.data.password, getDummyPasswordHash())
      throttle.recordFailure(normalizedIdentifier, clientIp)
      return jsonError(INVALID_CREDENTIALS, 401)
    }

    const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!validPassword) {
      throttle.recordFailure(normalizedIdentifier, clientIp)
      return jsonError(INVALID_CREDENTIALS, 401)
    }

    throttle.recordSuccess(normalizedIdentifier)

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
