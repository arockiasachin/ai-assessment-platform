"use client"

import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

export type ProgressBarProps = {
  value: number
  max?: number
  /** Visible label, e.g. "Milestone progress". */
  label?: string
  /** Right-aligned value text, e.g. "62%". Defaults to the percentage. */
  valueText?: string
  tone?: "primary" | "success" | "warning" | "destructive"
  className?: string
}

const TONE: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  primary: "",
  success: "[&_[data-slot=progress-indicator]]:bg-success",
  warning: "[&_[data-slot=progress-indicator]]:bg-warning",
  destructive: "[&_[data-slot=progress-indicator]]:bg-destructive",
}

/**
 * Labelled progress bar.
 *
 * The shared `Progress` primitive already renders the track, the indicator and
 * the correct ARIA progressbar roles; this wrapper adds a visible label/value
 * pair and a taller track, and re-colours the indicator by targeting its
 * `data-slot` so the primitive itself stays untouched.
 *
 * `"use client"` is required: `ProgressValue` takes a render-prop child, and a
 * function cannot be passed across the server/client boundary. Without it, any
 * Server Component rendering this fails the build with "Functions cannot be
 * passed directly to Client Components".
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = "primary",
  className,
}: ProgressBarProps) {
  const percent = max === 0 ? 0 : Math.round((value / max) * 100)

  return (
    <Progress
      value={value}
      max={max}
      className={cn(
        "flex-col gap-1.5",
        "[&_[data-slot=progress-track]]:h-2",
        TONE[tone],
        className,
      )}
    >
      {label && <ProgressLabel className="text-sm text-muted-foreground">{label}</ProgressLabel>}
      <ProgressValue>
        {(formattedValue) => valueText ?? formattedValue ?? `${percent}%`}
      </ProgressValue>
    </Progress>
  )
}
