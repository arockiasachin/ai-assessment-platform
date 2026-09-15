"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, UserPlus } from "lucide-react"

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
import { StatusPill } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"
import { AuthFeedback } from "../auth-feedback"

/** Administrators are provisioned by invitation, so they cannot self-register. */
const SELF_SERVICE_ROLES: MockupRole[] = ["student", "teacher"]
const MIN_PASSWORD_LENGTH = 12

type Feedback =
  | { kind: "none" }
  | { kind: "error"; title: string; message: string }
  | { kind: "success"; title: string; message: string }

/**
 * Registration form for the standalone auth mockup.
 *
 * The validation is real (client-side only) so the error state is honest: a
 * mismatched confirmation or a short password is rejected locally. A valid
 * submission lands on the pending-verification state, which is the truthful
 * first state of a new account.
 */
export function RegisterForm() {
  const [role, setRole] = useState<MockupRole>("student")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [acceptedPolicy, setAcceptedPolicy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>({ kind: "none" })

  const hasError = feedback.kind === "error"

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !email.trim() || !password || !confirmation) {
      setFeedback({
        kind: "error",
        title: "Some details are missing",
        message: "Your name, email address, and both password fields are required.",
      })
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFeedback({
        kind: "error",
        title: "Password is too short",
        message: `The institution requires at least ${MIN_PASSWORD_LENGTH} characters.`,
      })
      return
    }
    if (password !== confirmation) {
      setFeedback({
        kind: "error",
        title: "Passwords do not match",
        message: "Re-enter the confirmation so both password fields agree.",
      })
      return
    }
    if (!acceptedPolicy) {
      setFeedback({
        kind: "error",
        title: "Acceptable-use policy not accepted",
        message: "Tick the policy checkbox to finish creating your account.",
      })
      return
    }
    setFeedback({
      kind: "success",
      title: "Account created — pending verification",
      message: `A verification link would be sent to ${email.trim()}. No email is sent from this mockup.`,
    })
  }

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Create your account</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Join {BRAND.name} to sit assessments and follow your feedback. Staff and student accounts
          are verified before they can sign in.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="register-name">Full name</Label>
            <Input
              id="register-name"
              autoComplete="name"
              placeholder="Aarav Mehta"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? "register-feedback" : undefined}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-email">Email</Label>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="you@vitstudent.ac.in"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? "register-feedback" : undefined}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-role">I am joining as</Label>
            <Select
              value={role}
              onValueChange={(value) => {
                if (value === "student" || value === "teacher") setRole(value)
              }}
            >
              <SelectTrigger id="register-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELF_SERVICE_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ROLE_META[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Administrator accounts are created by invitation only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-password">Password</Label>
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby="register-password-hint"
              required
            />
            <p id="register-password-hint" className="text-xs text-muted-foreground">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-confirmation">Confirm password</Label>
            <Input
              id="register-confirmation"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={hasError || undefined}
              aria-describedby={hasError ? "register-feedback" : undefined}
              required
            />
          </div>

          <div className="flex items-start gap-2">
            <input
              id="register-policy"
              type="checkbox"
              checked={acceptedPolicy}
              onChange={(event) => setAcceptedPolicy(event.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <Label
              htmlFor="register-policy"
              className="text-sm leading-snug font-normal text-muted-foreground"
            >
              I accept the acceptable-use policy and understand that submitted work is retained for
              15 days after results are published.
            </Label>
          </div>

          {feedback.kind !== "none" && (
            <div id="register-feedback">
              <AuthFeedback tone={feedback.kind} title={feedback.title}>
                {feedback.message}
              </AuthFeedback>
            </div>
          )}

          {feedback.kind === "success" ? (
            <div className="space-y-3">
              <StatusPill status="pending" dot label="Pending verification" />
              <Link href="/mockup/auth/login" className={cn(buttonVariants(), "w-full")}>
                Continue to sign in
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <Button type="submit" className="w-full">
              <UserPlus className="size-4" aria-hidden="true" />
              Create account
            </Button>
          )}
        </form>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/mockup/auth/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
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
