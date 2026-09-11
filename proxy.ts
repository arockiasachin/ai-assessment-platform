import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const SESSION_COOKIE_NAME = "auth-user"

type SessionRole = "teacher" | "student" | "admin"

type SessionState = {
  role: SessionRole | null
  isValid: boolean
}

function getSessionState(cookieValue: string | undefined): SessionState {
  if (!cookieValue) return { role: null, isValid: false }

  try {
    const parsed = JSON.parse(cookieValue) as {
      role?: string
      user?: { role?: string }
      expiresAt?: number
    }
    const role = parsed.user?.role ?? parsed.role
    const expiresAt = parsed.expiresAt

    if (typeof expiresAt !== "number" || Date.now() > expiresAt) {
      return { role: null, isValid: false }
    }

    return {
      role: role === "teacher" || role === "student" || role === "admin" ? role : null,
      isValid: true,
    }
  } catch {
    return { role: null, isValid: false }
  }
}

function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const { role, isValid } = getSessionState(sessionCookie)
  const hasSessionCookie = Boolean(sessionCookie)
  const hasStaleSession = hasSessionCookie && !isValid

  const loginRedirect = () => {
    const response = NextResponse.redirect(new URL("/login", request.url))
    return hasStaleSession ? clearSessionCookie(response) : response
  }

  if (pathname.startsWith("/admin")) {
    if (!role || role !== "admin") {
      return loginRedirect()
    }
  }

  if (pathname.startsWith("/teacher")) {
    if (!role) {
      return loginRedirect()
    }

    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url))
    }

    if (role !== "teacher") {
      return NextResponse.redirect(new URL("/student", request.url))
    }
  }

  if (pathname.startsWith("/student")) {
    if (!role) {
      return loginRedirect()
    }

    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin", request.url))
    }

    if (role !== "student") {
      return NextResponse.redirect(new URL("/teacher", request.url))
    }
  }

  if ((pathname === "/login" || pathname === "/register") && role) {
    const destination = role === "admin" ? "/admin" : role === "teacher" ? "/teacher" : "/student"
    return NextResponse.redirect(new URL(destination, request.url))
  }

  if (hasStaleSession) {
    return clearSessionCookie(NextResponse.next())
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/", "/login", "/register", "/admin/:path*", "/teacher/:path*", "/student/:path*"],
}
