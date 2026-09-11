import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_SECONDS,
  signSessionValue,
  verifySessionValue,
  type AuthUser,
} from "@/lib/session"

export type { AuthUser, AuthRole } from "@/lib/session"
export { SESSION_COOKIE_NAME } from "@/lib/session"

function getCookieOptions(expiresAt?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: expiresAt ? new Date(expiresAt) : undefined,
    secure: process.env.NODE_ENV === "production",
  }
}

/**
 * Verify a raw `auth-user` cookie value. Exposed for tests and proxy-adjacent
 * code that already has the cookie string; the value is signed, so a tampered
 * or unsigned value always resolves to `null`.
 */
export function parseSessionCookie(value: string | null | undefined): AuthUser | null {
  return verifySessionValue(value)
}

/**
 * Read and verify the signed session. Every caller gets a server-derived user;
 * client-supplied role or id is never consulted.
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  return verifySessionValue(cookieStore.get(SESSION_COOKIE_NAME)?.value)
}

export async function setSessionUser(user: AuthUser) {
  const cookieStore = await cookies()
  cookieStore.set(
    SESSION_COOKIE_NAME,
    signSessionValue(user),
    getCookieOptions(Date.now() + SESSION_MAX_AGE_MS),
  )
}

export async function clearSessionUser() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export function createSessionResponse(user: AuthUser, body?: Record<string, unknown>) {
  const response = NextResponse.json({ success: true, user, ...(body ?? {}) })
  response.cookies.set(
    SESSION_COOKIE_NAME,
    signSessionValue(user),
    getCookieOptions(Date.now() + SESSION_MAX_AGE_MS),
  )
  return response
}

export function createLogoutResponse() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...getCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}
