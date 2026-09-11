import { NextResponse } from "next/server"

import { getSessionUser, type AuthRole, type AuthUser } from "@/lib/auth"
import { updateLogContext } from "@/lib/observability/context"

/**
 * Single server-side authorization entry point.
 *
 * `requireRole` / `requireUser` read the signed session (never a client-supplied
 * role or id), verify it, and enforce the role. They are the only guard route
 * handlers should use; the `proxy.ts` matcher is an optimistic pre-check, not a
 * substitute for verifying in the handler itself.
 *
 * Callers use the result explicitly:
 *
 * ```ts
 * const auth = await requireRole("teacher")
 * if (!auth.authorized) return auth.response
 * const { user } = auth
 * ```
 */

export type AuthorizationResult =
  { authorized: true; user: AuthUser } | { authorized: false; response: NextResponse }

function deny(status: 401 | 403, message: string): AuthorizationResult {
  return { authorized: false, response: NextResponse.json({ success: false, message }, { status }) }
}

/** Require any authenticated user. */
export async function requireUser(): Promise<AuthorizationResult> {
  const user = await getSessionUser()
  if (!user) return deny(401, "Unauthorized")
  updateLogContext({ userId: user.id, userRole: user.role })
  return { authorized: true, user }
}

/** Require an authenticated user whose role is one of `roles`. */
export async function requireRole(...roles: AuthRole[]): Promise<AuthorizationResult> {
  const user = await getSessionUser()
  if (!user) return deny(401, "Unauthorized")
  if (roles.length > 0 && !roles.includes(user.role)) return deny(403, "Forbidden")
  updateLogContext({ userId: user.id, userRole: user.role })
  return { authorized: true, user }
}
