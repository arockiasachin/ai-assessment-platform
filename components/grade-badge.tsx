import { cn } from "@/lib/utils"
import { gradeBand, type GradeBand } from "@/lib/gradebook"

/**
 * Grade band chip.
 *
 * The tinted backgrounds are translucent, so the text colour must clear 4.5:1
 * against the tint itself, not against the page. The theme's `success`/`warning`
 * tokens are tuned for solid fills and only reach ~2.9:1 / ~2.2:1 when used as
 * text on their own tint, so the band text uses explicit darker shades in light
 * mode and lighter shades in dark mode. The `dark` Tailwind variant is scoped to
 * a `.dark` class that this app never sets (it themes via
 * `prefers-color-scheme`), hence the explicit media variant.
 */
const bandStyles: Record<GradeBand, string> = {
  excellent:
    "bg-emerald-500/15 text-emerald-800 border-emerald-600/30 [@media(prefers-color-scheme:dark)]:text-emerald-400",
  good: "bg-primary/12 text-primary border-primary/25",
  pass: "bg-amber-500/18 text-amber-800 border-amber-600/35 [@media(prefers-color-scheme:dark)]:text-amber-400",
  fail: "bg-red-500/12 text-red-700 border-red-600/30 [@media(prefers-color-scheme:dark)]:text-red-400",
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
      {/*
        The percentage, and deliberately **no letter**. A VIT letter describes a course grand
        total, not one assessment, and every surface this badge appears on is a single mark — a
        gradebook cell, one row of a student's assessment list. A conditional letter lived here for
        a while and no call site ever asked for it, which is the honest answer.
      */}
      {pct === null ? "—" : `${Math.round(pct)}%`}
    </span>
  )
}
