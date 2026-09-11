import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

import { newRequestId } from "@/lib/observability/ids"
import { getProcessLogger } from "@/lib/observability/logger"
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
 * Emit one structured `http.request` line for every `/api/**` request and
 * forward the correlation id to the route handler.
 *
 * This is the universal half of request logging: it covers every API route,
 * including ones that have not adopted `withApiRoute`. The actor is read from
 * the signature-verified session cookie, never from a request header. No body,
 * query string, or header value is logged.
 */
function observeApiRequest(request: NextRequest): NextResponse {
  const route = request.nextUrl.pathname
  const requestId = request.headers.get("x-request-id")?.trim() || newRequestId()
  const user = verifySessionValue(request.cookies.get(SESSION_COOKIE_NAME)?.value)

  getProcessLogger().info("http.request", {
    requestId,
    route,
    method: request.method,
    userId: user?.id,
    userRole: user?.role,
  })

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-request-id", requestId)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("x-request-id", requestId)
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

  // API routes are instrumented, not authorized, here: every handler still
  // re-verifies the session with `requireRole`. This branch only logs the
  // request and passes the correlation id downstream.
  if (pathname.startsWith("/api/")) {
    return observeApiRequest(request)
  }

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
    "/api/:path*",
  ],
}
