import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { SESSION_COOKIE_NAME, verifySessionValue, type AuthRole } from "@/lib/session"

function homeForRole(role: AuthRole) {
  if (role === "admin") return "/admin"
  if (role === "teacher") return "/teacher"
  return "/student"
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}

/**
 * Optimistic, signature-verified routing gate.
 *
 * This is deliberately *not* the authorization boundary: it only redirects
 * unauthenticated or wrong-role browsers before rendering. Every route handler
 * re-verifies the session with `requireRole` from `lib/authz`. The cookie value
 * is verified with HMAC-SHA256, so an unsigned or tampered `auth-user` value is
 * treated as no session at all.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const user = verifySessionValue(sessionCookie)
  const role = user?.role ?? null
  const hasStaleSession = Boolean(sessionCookie) && !user

  const loginRedirect = () => {
    const response = NextResponse.redirect(new URL("/login", request.url))
    return hasStaleSession ? clearSessionCookie(response) : response
  }

  if (pathname.startsWith("/admin")) {
    if (!role) return loginRedirect()
    if (role !== "admin") return NextResponse.redirect(new URL(homeForRole(role), request.url))
  }

  if (pathname.startsWith("/teacher")) {
    if (!role) return loginRedirect()
    if (role !== "teacher") return NextResponse.redirect(new URL(homeForRole(role), request.url))
  }

  if (pathname.startsWith("/student")) {
    if (!role) return loginRedirect()
    if (role !== "student") return NextResponse.redirect(new URL(homeForRole(role), request.url))
  }

  // The quiz surface takes an assessment, so it is never public. Any signed-in
  // role may open it; the answer-key handling is server-authoritative work that
  // lands with the Phase 2 grading pipeline.
  if (pathname === "/quiz" || pathname.startsWith("/quiz/")) {
    if (!role) return loginRedirect()
  }

  if ((pathname === "/login" || pathname === "/register") && role) {
    return NextResponse.redirect(new URL(homeForRole(role), request.url))
  }

  if (hasStaleSession) {
    return clearSessionCookie(NextResponse.next())
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/register",
    "/quiz",
    "/quiz/:path*",
    "/admin/:path*",
    "/teacher/:path*",
    "/student/:path*",
  ],
}
