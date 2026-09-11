import { NextResponse } from "next/server"

import { getSessionUser, type AuthRole, type AuthUser } from "@/lib/auth"
import { revalidateSessionActor } from "@/lib/authz-actor"
import { updateLogContext } from "@/lib/observability/context"

/**
 * Single server-side authorization entry point.
 *
 * `requireRole` / `requireUser` read the signed session (never a client-supplied
 * role or id), verify it, enforce the role, and then re-check the actor against
 * the database so a demoted or deleted user cannot keep acting on a stale
 * session. They are the only guard route handlers should use; the `proxy.ts`
 * matcher is an optimistic pre-check, not a substitute for verifying in the
 * handler itself.
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

async function authorize(roles: AuthRole[]): Promise<AuthorizationResult> {
  const claimed = await getSessionUser()
  if (!claimed) return deny(401, "Unauthorized")
  // Cheap role gate first: a session that is already the wrong role never costs
  // a database lookup.
  if (roles.length > 0 && !roles.includes(claimed.role)) return deny(403, "Forbidden")

  // Confirm the actor still exists and the database role still matches the
  // session claim. A mismatch or a missing user is a 401, not a 403: the
  // session itself is no longer valid. See `lib/authz-actor.ts` for the
  // short-lived cache and its staleness window.
  const user = await revalidateSessionActor(claimed)
  if (!user) return deny(401, "Unauthorized")

  updateLogContext({ userId: user.id, userRole: user.role })
  return { authorized: true, user }
}

/** Require any authenticated user. */
export async function requireUser(): Promise<AuthorizationResult> {
  return authorize([])
}

/** Require an authenticated user whose role is one of `roles`. */
export async function requireRole(...roles: AuthRole[]): Promise<AuthorizationResult> {
  return authorize(roles)
}
