import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type StatCardProps = {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  accent?: "primary" | "success" | "warning" | "destructive"
}

const accentMap = {
  primary: "text-primary bg-primary/10",
  success: "text-success bg-success/12",
  warning: "text-warning bg-warning/15",
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
