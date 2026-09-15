"use client"

import Link from "next/link"
import { useState } from "react"
import { LogIn } from "lucide-react"

import { AuthFeedback } from "@/components/auth-feedback"
import { AuthPageShell } from "@/components/auth-page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Sign in.
 *
 * Restyled onto the mockup's frame. The submission path is unchanged: same
 * `POST /api/auth/login`, same error surfacing, and the same
 * `window.location.assign` afterwards — a **full** navigation is deliberate here
 * because it disposes of all client state on a credential change
 * (`docs/verification/phase-1-verification.md`).
 *
 * Three mockup affordances are deliberately **not** carried over:
 *
 * - **A "sign in as" role selector.** There is no backing for it — the role is
 *   derived server-side from the account — and offering it would invite a user
 *   to pick a workspace they have no account in.
 * - **"Forgot password?"** There is no reset flow; the mockup's version resolved
 *   to an error explaining its own absence.
 * - **"Keep me signed in on this device."** The session lifetime is fixed
 *   server-side (`SESSION_MAX_AGE_SECONDS`) and no remember-me parameter exists,
 *   so the checkbox would change nothing.
 *
 * The identifier field stays a **username-or-email** `text` input, not the
 * mockup's `type="email"`: `loginRequestSchema.email` is a non-empty string, and
 * the seeded administrator's identifier is literally `admin`, which `type="email"`
 * would refuse to submit.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.message || "Login failed")
        return
      }

      const destination =
        data.user.role === "admin"
          ? "/admin"
          : data.user.role === "teacher"
            ? "/teacher"
            : "/student"
      window.location.assign(destination)
    } catch {
      setError("Unable to reach the authentication server.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthPageShell
      title="Welcome back"
      description="Sign in to review AI-assisted marks, author assessments, and follow your feedback."
      footer={
        <p className="text-sm text-muted-foreground">
          Don’t have an account yet?{" "}
          <Link
            href="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Username or email</Label>
          <Input
            id="email"
            type="text"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin or name@example.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-feedback" : undefined}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-feedback" : undefined}
            required
          />
        </div>

        {error ? (
          <div id="login-feedback">
            <AuthFeedback tone="error" title="Could not sign in">
              {error}
            </AuthFeedback>
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={isLoading}>
          <LogIn className="size-4" aria-hidden="true" />
          {isLoading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthPageShell>
  )
}
