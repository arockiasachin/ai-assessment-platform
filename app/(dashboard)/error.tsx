"use client"

import { useEffect } from "react"

import { Button } from "@/components/ui/button"

/**
 * Route-group error boundary.
 *
 * A thrown server-component query (for example a failed Prisma read) previously
 * fell through to the framework's default error screen with no way back. This
 * keeps the page shell and offers a retry.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center text-foreground">
      <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
      <p role="alert" className="max-w-sm text-sm text-muted-foreground">
        This page could not be loaded. You can try again, or return to the dashboard.
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  )
}
