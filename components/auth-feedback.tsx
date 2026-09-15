import { CircleAlert, CircleCheck } from "lucide-react"

import { Callout } from "@/components/ui/callout"

export type AuthFeedbackTone = "error" | "success"

/**
 * Inline result banner for the auth screens.
 *
 * A thin adapter over `Callout` so the auth pages cannot drift from the shared
 * tone pairs: `destructive/10` + `text-destructive` and `success/15` + the
 * darker success shade, each with its own dark-mode override.
 *
 * Unlike static guidance, this banner is the result of the action the user just
 * took, so it keeps a live role: `alert` for an error, `status` for a success —
 * which is what makes a screen reader announce it without moving focus.
 *
 * This file used to live at `app/(mockup-standalone)/mockup/auth/auth-feedback.tsx`.
 * The mockup module is now a re-export, so the mockup screens keep working and
 * the component has exactly one definition.
 */
export function AuthFeedback({
  tone,
  title,
  children,
  className,
}: {
  tone: AuthFeedbackTone
  title: string
  children: React.ReactNode
  className?: string
}) {
  const isError = tone === "error"

  return (
    <Callout
      tone={isError ? "destructive" : "success"}
      icon={isError ? CircleAlert : CircleCheck}
      role={isError ? "alert" : "status"}
      title={title}
      className={className}
    >
      {children}
    </Callout>
  )
}
