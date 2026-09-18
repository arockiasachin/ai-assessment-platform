"use client"

import { useId, useState } from "react"
import { ChevronDown, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type CollapsibleSectionProps = {
  title: string
  /** Icon shown before the title — a second cue that each block is distinct. */
  icon?: LucideIcon
  /** Start expanded (default) or collapsed. */
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * One labelled, individually collapsible block of a task brief.
 *
 * The brief pane used to be a single undifferentiated card: one muted paragraph
 * of instructions followed by loose metadata, with nothing to separate the
 * problem from the limits from the history. This gives every section a heading
 * with an icon, a rule above it and its own disclosure, so blocks are
 * distinguishable at a glance and a long brief can be folded away.
 *
 * The panel is always rendered and toggled with `hidden` rather than unmounted,
 * so the `aria-controls` target exists in both states and `id`-based tests can
 * find it while collapsed.
 */
export function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const reactId = useId()
  const panelId = `${reactId}-panel`

  return (
    <section className={cn("min-w-0", className)}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 rounded-md py-1.5 text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {Icon && <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          <span className="text-lg font-semibold tracking-tight">{title}</span>
          <ChevronDown
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div
        id={panelId}
        hidden={!open}
        className="space-y-4 pt-2 pb-1 text-base leading-7 text-foreground"
      >
        {children}
      </div>
    </section>
  )
}
