import { SignJWT } from "jose"
import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { getSessionUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * `POST /api/support/presign`
 *
 * Mints a short-lived, single-workspace identity token for the support widget.
 * This is the entire host-side integration: the widget calls this endpoint, gets a
 * token, and exchanges it with the support desk for a session.
 *
 * ## Why the token is minted here and not in the browser
 *
 * `SUPPORT_DESK_SSO_SECRET` proves who a user is. If it reached the browser,
 * anyone could mint a token for anyone else and read their support history. So it
 * lives only in the server environment and is used only in this file.
 *
 * ## Why the TTL is minutes, not days
 *
 * The token is exchanged immediately for a session, so it never needs to be valid
 * for long. A short life bounds the damage if one is captured in transit or in a
 * log. The session it becomes has its own, longer life and can be revoked
 * independently.
 *
 * ## Why the role is not trusted
 *
 * The support desk does not grant support-desk authority from this token. It only
 * identifies the requester. Who may *work* the queue is decided entirely by
 * memberships inside the support desk, so a forged-up role here would change
 * nothing.
 */

/** Minutes. Deliberately short — see above. */
const TOKEN_TTL_SECONDS = 5 * 60

/** The `iss`/`aud` pair the support desk validates against. */
const SUPPORT_AUDIENCE = "support-desk"
const SUPPORT_ISSUER = "support-desk"

function requireEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

export async function POST() {
  const user = await getSessionUser()
  if (!user) return jsonError("Unauthorized", 401)

  const secret = requireEnv("SUPPORT_DESK_SSO_SECRET")
  const workspaceId = requireEnv("SUPPORT_DESK_WORKSPACE_ID")

  if (!secret || !workspaceId) {
    // Configuration, not an application error. The widget reports "could not
    // verify your session" to the user; this log is what tells an operator why.
    console.error(
      "[support] SUPPORT_DESK_SSO_SECRET and SUPPORT_DESK_WORKSPACE_ID must both be set to mint a support token.",
    )
    return jsonError("Support is not configured on this deployment.", 503)
  }

  // The display name lives on a profile, not on `User`; fall back to the email
  // address so a ticket is never filed by an unnamed requester.
  const [student, staff] = await Promise.all([
    prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { fullName: true } }),
    prisma.staffProfile.findUnique({ where: { userId: user.id }, select: { fullName: true } }),
  ])

  const name = student?.fullName ?? staff?.fullName ?? user.email

  const issuedAt = Math.floor(Date.now() / 1000)

  const token = await new SignJWT({
    // The support desk's own identifier for this person. Using our `User.id`
    // means the same human is recognised across sessions without the desk ever
    // holding our credentials or duplicating our user table.
    externalId: user.id,
    workspaceId,
    email: user.email,
    name,
    // Recorded so an agent can see which product surface the requester belongs
    // to. Not an authorization input.
    metadata: { role: user.role },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(issuedAt)
    .setIssuer(SUPPORT_ISSUER)
    .setAudience(SUPPORT_AUDIENCE)
    .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))

  return NextResponse.json(
    { success: true, token },
    // Never cached: a stored token would be handed to the next user of this
    // browser or proxy.
    { headers: { "cache-control": "no-store" } },
  )
}
