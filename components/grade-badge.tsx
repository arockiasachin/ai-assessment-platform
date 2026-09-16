import { cn } from "@/lib/utils"
import { gradeBand, type GradeBand } from "@/lib/gradebook"

/**
 * Grade band chip.
 *
 * The tinted backgrounds are translucent, so the text colour must clear 4.5:1
 * against the tint itself, not against the page — which is why these use explicit
 * darker shades in light mode and lighter ones in dark mode rather than the
 * `--success` / `--warning` tokens, whose text contrast is documented in
 * `@/components/ui/tone`.
 *
 * **The dark shades use `dark:`, not a `prefers-color-scheme` media query.** A media
 * query follows the *operating system*, so a user on a dark-OS machine who explicitly
 * picks light mode would still get the dark-mode shades (and the reverse) — wrong
 * colours in the mode they asked for. `theme-toggle.tsx` maintains a `.dark` class on
 * `<html>` and `globals.css` declares `@custom-variant dark (&:is(.dark *))`, so `dark:`
 * follows the user's choice. An earlier version of this file used the media variant on
 * the mistaken belief that the app never sets `.dark`; it does, in both the pre-paint
 * init script and the toggle.
 */
const bandStyles: Record<GradeBand, string> = {
  excellent: "bg-emerald-500/15 text-emerald-800 border-emerald-600/30 dark:text-emerald-400",
  good: "bg-primary/12 text-primary border-primary/25",
  pass: "bg-amber-500/18 text-amber-800 border-amber-600/35 dark:text-amber-400",
  fail: "bg-red-500/12 text-red-700 border-red-600/30 dark:text-red-400",
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
