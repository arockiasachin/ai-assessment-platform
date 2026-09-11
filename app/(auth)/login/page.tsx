"use client"

import Link from "next/link"
import { useState } from "react"

import { AuthPageShell } from "@/components/auth-page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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

      const destination = data.user.role === "admin" ? "/admin" : data.user.role === "teacher" ? "/teacher" : "/student"
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
      description="Sign in to continue to Gradebook and access assessment progress for teachers and students."
      footer={
        <>
          <p className="text-sm text-muted-foreground">
            Don’t have an account yet?{' '}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Create one
            </Link>
          </p>
          <Link
            href="/"
            className="inline-flex justify-center rounded-lg border border-border bg-muted/60 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Back to dashboard
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Username or email</Label>
          <Input
            id="email"
            type="text"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin or name@example.com"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </AuthPageShell>
  )
}
