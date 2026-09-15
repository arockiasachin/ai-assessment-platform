import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatDelta = {
  /** Pre-formatted, e.g. "+4 pts" or "−25". */
  value: string
  direction: "up" | "down" | "flat"
  /**
   * Whether this movement is good news. Defaults to `neutral`, so a delta is
   * never coloured by direction alone.
   */
  sentiment?: "positive" | "negative" | "neutral"
}

export type StatCardProps = {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  delta?: StatDelta
  /** Slot for a `<Sparkline />` or any other compact visual. */
  sparkline?: React.ReactNode
  className?: string
}

/**
 * Compact metric tile: label, value, optional delta, optional sparkline.
 *
 * The delta uses `--success`/`--destructive` semantically (good news / bad news)
 * rather than up/down, because "down" is good for an at-risk count. The
 * positive shade is the darker green that clears 4.5:1 on `bg-card`; the raw
 * `--success` token only reaches ~2.6:1 as text.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  sparkline,
  className,
}: StatCardProps) {
  const deltaTone = {
    positive: "text-[oklch(0.45_0.12_155)] dark:text-success",
    negative: "text-destructive",
    neutral: "text-muted-foreground",
  } as const
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus

  return (
    <Card className={cn("gap-3 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-mono text-2xl leading-tight font-semibold tabular-nums">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          {delta && (
            <p
              className={cn(
                "mt-1 inline-flex items-center gap-1 text-xs font-medium",
                deltaTone[delta.sentiment ?? "neutral"],
              )}
            >
              <DeltaIcon className="size-3.5" aria-hidden="true" />
              {delta.value}
              <span className="sr-only"> compared with the previous period</span>
            </p>
          )}
        </div>
        {sparkline && <div className="shrink-0">{sparkline}</div>}
      </div>
    </Card>
  )
}
