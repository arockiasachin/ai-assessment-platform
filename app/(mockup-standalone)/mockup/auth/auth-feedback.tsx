import { CircleAlert, CircleCheck } from "lucide-react"

import { Callout } from "@/components/ui/callout"

export type AuthFeedbackTone = "error" | "success"

/**
 * Inline result banner for the auth mockups.
 *
 * A thin adapter over `Callout` so the mockup screens cannot drift from the
 * shared tone pairs: `destructive/10` + `text-destructive` and `success/15` +
 * the darker success shade, each with its own dark-mode override. This file used
 * to carry its own copy of those classes (including the success colour literal).
 *
 * Unlike static guidance, this banner is the result of the action the user just
 * took, so it keeps a live role: `alert` for an error, `status` for a success.
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
