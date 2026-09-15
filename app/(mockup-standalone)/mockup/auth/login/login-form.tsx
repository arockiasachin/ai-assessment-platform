"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, LogIn } from "lucide-react"

import { BRAND, ROLE_META, type MockupRole } from "@/components/shell/nav-config"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { AuthFeedback } from "../auth-feedback"

const ROLES: MockupRole[] = ["admin", "teacher", "student"]

/**
 * Base UI renders the label of the selected item only when the `Select` root
 * knows the value→label map, so the trigger would otherwise read "admin"
 * instead of "Administrator".
 */
const ROLE_ITEMS = ROLES.map((role) => ({ value: role, label: ROLE_META[role].label }))

type Feedback =
  | { kind: "none" }
  | { kind: "error"; title: string; message: string }
  | { kind: "success"; title: string; message: string; role: MockupRole }

/**
 * Sign-in form for the standalone auth mockup.
 *
 * Client-side only because the screen has to demonstrate open and resolved
 * states (a validation error, a successful sign-in, and the "reset" dead end).
 * Nothing is submitted anywhere: there is no `fetch`, no session, and no
 * credential checking.
 */
export function LoginForm() {
  const [role, setRole] = useState<MockupRole>("admin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" })

  const hasError = feedback.kind === "error"

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setFeedback({
        kind: "error",
        title: "Sign-in details incomplete",
        message: "An email address and a password are both required to sign in.",
      })
      return
    }
    setFeedback({
      kind: "success",
      title: `Signed in as ${ROLE_META[role].label.toLowerCase()}`,
      message: "Mockup only — any credentials are accepted and nothing leaves this page.",
      role,
    })
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Welcome back</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Sign in to {BRAND.name} to review AI-assisted marks, author assessments, and manage the
          institution.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-role">Sign in as</Label>
            <Select
              value={role}
              items={ROLE_ITEMS}
              onValueChange={(value) => {
                if (value === "admin" || value === "teacher" || value === "student") setRole(value)
              }}
            >
              <SelectTrigger id="login-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_META[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              One email space serves every role, so the sign-in screen asks which workspace to open.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@vit.ac.in"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? "login-feedback" : undefined}
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="login-password">Password</Label>
              <button
                type="button"
                onClick={() =>
                  setFeedback({
                    kind: "error",
                    title: "Password reset is not available",
                    message:
                      "Reset links are outside the mockup. Enter any value and sign in to preview the success state.",
                  })
                }
                className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? "login-feedback" : undefined}
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="login-remember"
              type="checkbox"
              defaultChecked
              className="size-4 accent-primary"
            />
            <Label htmlFor="login-remember" className="text-sm font-normal text-muted-foreground">
              Keep me signed in on this device
            </Label>
          </div>

          {feedback.kind !== "none" && (
            <div id="login-feedback">
              <AuthFeedback tone={feedback.kind} title={feedback.title}>
                {feedback.message}
              </AuthFeedback>
            </div>
          )}

          {feedback.kind === "success" ? (
            <Link href={ROLE_META[feedback.role].home} className={cn(buttonVariants(), "w-full")}>
              Open the {ROLE_META[feedback.role].label} workspace
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <Button type="submit" className="w-full">
              <LogIn className="size-4" aria-hidden="true" />
              Sign in
            </Button>
          )}
        </form>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <p className="text-sm text-muted-foreground">
          No account yet?{" "}
          <Link
            href="/mockup/auth/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create one
          </Link>
        </p>
        <Link
          href={BRAND.indexHref}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          Back to the mockup index
        </Link>
      </CardFooter>
    </Card>
  )
}
