import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { SUCCESS_TEXT, WARNING_TEXT } from "@/components/ui/tone"
import { cn } from "@/lib/utils"

type StatCardProps = {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  accent?: "primary" | "success" | "warning" | "destructive"
}

/**
 * Accent tints for the icon chip.
 *
 * `success` and `warning` use the text-safe pairs from `@/components/ui/tone` rather than the raw
 * tokens: both raw tokens fail against their own tint (`--success` reaches 2.76:1, `--warning`
 * 2.54:1, where even the 3:1 non-text threshold for an icon is not met). `primary` and
 * `destructive` pass as-is, which is why only two entries carry the helper.
 */
const accentMap = {
  primary: "text-primary bg-primary/10",
  success: `${SUCCESS_TEXT} bg-success/12`,
  warning: `${WARNING_TEXT} bg-warning/15`,
  destructive: "text-destructive bg-destructive/12",
} as const

export function StatCard({ label, value, sub, icon: Icon, accent = "primary" }: StatCardProps) {
  return (
    <Card className="flex flex-row items-center gap-4 p-4">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          accentMap[accent],
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="font-mono text-2xl font-semibold leading-tight tabular-nums text-foreground">
          {value}
        </p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  )
}
