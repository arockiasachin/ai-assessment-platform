import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export type AuthUser = {
  id: string
  email: string
  role: "teacher" | "student" | "admin"
}

const SESSION_COOKIE_NAME = "auth-user"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE * 1000

type SessionCookiePayload = {
  user: AuthUser
  expiresAt: number
}

function createSessionCookieValue(user: AuthUser) {
  return JSON.stringify({
    user,
    expiresAt: Date.now() + SESSION_MAX_AGE_MS,
  } satisfies SessionCookiePayload)
}

function getCookieOptions(expiresAt?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    expires: expiresAt ? new Date(expiresAt) : undefined,
    secure: process.env.NODE_ENV === "production",
  }
}

export async function getSessionUser() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value

  if (!sessionCookie) return null

  try {
    const payload = JSON.parse(sessionCookie) as Partial<SessionCookiePayload>

    if (!payload.user || typeof payload.expiresAt !== "number") {
      return null
    }

    if (Date.now() > payload.expiresAt) {
      return null
    }

    return payload.user as AuthUser
  } catch {
    return null
  }
}

export async function setSessionUser(user: AuthUser) {
  const cookieStore = await cookies()
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS
  cookieStore.set(SESSION_COOKIE_NAME, createSessionCookieValue(user), getCookieOptions(expiresAt))
}

export async function clearSessionUser() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export function createSessionResponse(user: AuthUser, body?: Record<string, unknown>) {
  const response = NextResponse.json({ success: true, user, ...(body ?? {}) })
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS
  response.cookies.set(
    SESSION_COOKIE_NAME,
    createSessionCookieValue(user),
    getCookieOptions(expiresAt),
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
