"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { UserPlus } from "lucide-react"

import { AuthFeedback } from "@/components/auth-feedback"
import { AuthPageShell } from "@/components/auth-page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Only these two can self-register; `registerRequestSchema.role` is
 * `z.enum(["teacher", "student"])` and the route rejects the reserved admin
 * identifier separately.
 */
const ROLE_ITEMS = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
]

/**
 * Create an account.
 *
 * Restyled onto the mockup's frame, with the role select upgraded from a native
 * `<select>` to the shared `Select` (Base UI renders the raw value on the trigger
 * unless the root receives the value→label map, so `items` is passed).
 *
 * The submission path is unchanged: same confirm-password check, same
 * `POST /api/auth/register`, same `router.push("/login")`.
 *
 * Four mockup affordances are deliberately **not** carried over, each because it
 * would describe or require something the backend does not do:
 *
 * - **A "Full name" field.** `registerRequestSchema` has no `name`, and the route
 *   derives `fullName` from the email — so the field could not be submitted.
 * - **A "pending verification" success screen.** Registration signs the user in
 *   immediately (`createSessionResponse`); there is no verification step, so the
 *   screen would be fiction. The existing redirect is the real completion.
 * - **A required acceptable-use checkbox.** Nothing records acceptance, and
 *   adding a required gate to a working registration flow is a behaviour change,
 *   not a restyle. If the policy needs real acceptance, it needs a column first.
 * - **A 12-character password minimum.** The mockup enforced this client-side
 *   with copy claiming "the institution requires at least 12 characters", but the
 *   contract accepts `min(1)`. A client-only rule would reject registrations the
 *   server would accept — a restriction invented by a restyle.
 */
/** Readable ids for the fields an error can implicate. */
type Field = "email" | "password" | "confirmPassword"

/**
 * Which fields an error actually implicates.
 *
 * A client-side rule knows exactly which fields it means. An unexpected server or
 * network failure implicates none of them, so the banner carries the message and
 * no field is marked — better than asserting something is wrong when it is not.
 */
type ErrorState =
  { kind: "none" } | { kind: "error"; title: string; message: string; fields: Field[] }

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [role, setRole] = useState("student")
  const [error, setError] = useState<ErrorState>({ kind: "none" })
  const [isLoading, setIsLoading] = useState(false)

  // `aria-invalid` is a claim that *this* control is wrong, so it is set only on
  // the fields the error is actually about. Announcing a valid email as invalid
  // because two password fields disagree is worse than saying nothing.
  const invalid = (field: Field) =>
    error.kind === "error" && error.fields.includes(field) ? true : undefined
  const describedBy = (field: Field) =>
    error.kind === "error" && error.fields.includes(field) ? "register-feedback" : undefined

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError({ kind: "none" })

    if (password !== confirmPassword) {
      setError({
        kind: "error",
        title: "Passwords do not match",
        message: "Re-enter the confirmation so both password fields agree.",
        fields: ["password", "confirmPassword"],
      })
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        // A rejected registration is usually about the identifier — already in
        // use, or reserved — so that is the field it is honest to mark.
        setError({
          kind: "error",
          title: "Could not create the account",
          message: data.message || "Registration failed",
          fields: ["email"],
        })
        return
      }

      router.push("/login")
    } catch {
      setError({
        kind: "error",
        title: "Could not create the account",
        message: "Unable to reach the authentication server.",
        // Nothing about the form is wrong: the request never landed.
        fields: [],
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthPageShell
      title="Create your account"
      description="Join Rubrix to sit assessments, submit work, and follow your feedback. Administrator accounts are created by invitation only."
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email")}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="role">I am joining as</Label>
          <Select
            value={role}
            items={ROLE_ITEMS}
            onValueChange={(value) => {
              if (value === "student" || value === "teacher") setRole(value)
            }}
          >
            <SelectTrigger id="role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_ITEMS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Administrator accounts are created by invitation only.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Choose a password"
            aria-invalid={invalid("password")}
            aria-describedby={describedBy("password")}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Re-enter password"
            aria-invalid={invalid("confirmPassword")}
            aria-describedby={describedBy("confirmPassword")}
            required
          />
        </div>

        {error.kind === "error" ? (
          <div id="register-feedback">
            <AuthFeedback tone="error" title={error.title}>
              {error.message}
            </AuthFeedback>
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={isLoading}>
          <UserPlus className="size-4" aria-hidden="true" />
          {isLoading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthPageShell>
  )
}
