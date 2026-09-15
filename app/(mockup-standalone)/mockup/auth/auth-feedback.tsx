import { CircleAlert, CircleCheck } from "lucide-react"

import { cn } from "@/lib/utils"

export type AuthFeedbackTone = "error" | "success"

/**
 * Inline result banner for the auth mockups.
 *
 * Both tones use the measured WCAG-AA pairs from the design system
 * (`destructive/10` + `text-destructive`; `success/15` + the darker success
 * shade, with explicit `dark:` overrides), so the same component clears 4.5:1 in
 * both themes.
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
  const Icon = tone === "error" ? CircleAlert : CircleCheck

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/12"
          : "border-success/40 bg-success/15 text-[oklch(0.45_0.12_155)] dark:bg-success/20 dark:text-success",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title}</p>
        <p className="text-pretty">{children}</p>
      </div>
    </div>
  )
}
