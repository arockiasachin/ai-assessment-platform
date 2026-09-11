import { cn } from "@/lib/utils"
import { gradeBand, letterGrade, type GradeBand } from "@/lib/gradebook"

const bandStyles: Record<GradeBand, string> = {
  excellent: "bg-success/15 text-success border-success/30",
  good: "bg-primary/12 text-primary border-primary/25",
  pass: "bg-warning/18 text-warning border-warning/35",
  fail: "bg-destructive/12 text-destructive border-destructive/30",
  ungraded: "bg-muted text-muted-foreground border-border",
}

export function GradeBadge({ pct, className }: { pct: number | null; className?: string }) {
  const band = gradeBand(pct)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums",
        bandStyles[band],
        className,
      )}
    >
      {pct === null ? "—" : `${Math.round(pct)}%`}
      {pct !== null && <span className="opacity-60">{letterGrade(pct)}</span>}
    </span>
  )
}
