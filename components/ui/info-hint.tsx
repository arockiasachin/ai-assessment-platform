"use client"

import { Popover } from "@base-ui/react/popover"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"

export type InfoHintProps = {
  /**
   * The accessible name. It must say **what** the hint explains, not "more
   * information": the trigger is an icon-only button, so this string is the only
   * thing assistive tech (and a sighted keyboard user's tooltip) has to identify
   * it. E.g. "How the term average is calculated".
   */
  label: string
  /** The explanation revealed while the popover is open. */
  children: React.ReactNode
  className?: string
}

/**
 * An icon button that reveals static guidance in a popover.
 *
 * The clutter pass moved explanatory prose here rather than deleting it: the
 * reasoning stays available, but it no longer occupies space that results and
 * blocked states need. The distinction the callers must honour is **static
 * guidance may collapse; the result of an action the student just took may
 * not** — submission-lock reasons, gate refusals, `role="status"`/`role="alert"`
 * feedback and empty states stay visible.
 *
 * Reuses `@base-ui/react/popover` — the same dependency the top bar's account and
 * notifications menus use — and adds no new library, following that
 * `Root`/`Trigger`/`Portal`/`Positioner`/`Popup` composition. The trigger is a
 * real `<button>` (Base UI supplies `aria-expanded`/`aria-haspopup`) with an
 * `aria-label` that names what it explains, so it is keyboard operable by
 * default: Enter/Space opens, Escape closes and returns focus to the trigger.
 *
 * `keepMounted` keeps the popup in the DOM while closed (Base UI marks it
 * `hidden`/`inert`), which is what lets the guidance survive in the rendered
 * tree instead of being the only copy.
 */
export function InfoHint({ label, children, className }: InfoHintProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal keepMounted>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup
            aria-label={label}
            className="max-w-xs rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md outline-none"
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
