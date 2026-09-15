"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type PageTab = {
  value: string
  label: string
  /** Optional trailing count, e.g. "Pending 6". */
  count?: number
}

export type PageTabsProps = {
  items: PageTab[]
  /** Defaults to the first tab. */
  defaultValue?: string
  /** Accessible name for the tab list. */
  label?: string
  /** `PageTabPanel`s, one per item. */
  children?: React.ReactNode
  className?: string
}

/**
 * In-page section tabs (Overview / Criteria / Runs …).
 *
 * A thin wrapper over the shared `Tabs` primitive, which already implements the
 * ARIA tabs pattern: `role="tablist"`, arrow-key navigation, and `aria-selected`
 * on the active tab. Pages own the panels so their content stays a Server
 * Component.
 */
export function PageTabs({
  items,
  defaultValue,
  label = "Sections",
  children,
  className,
}: PageTabsProps) {
  return (
    <Tabs defaultValue={defaultValue ?? items[0]?.value} className={className}>
      <TabsList
        variant="line"
        aria-label={label}
        className="w-full justify-start border-b border-border"
      >
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="flex-none px-3">
            {item.label}
            {typeof item.count === "number" && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                {item.count}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}

/** One tab's panel. `value` must match the matching item in `PageTabs`. */
export function PageTabPanel({
  value,
  children,
  className,
}: {
  value: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <TabsContent value={value} className={cn("pt-4", className)}>
      {children}
    </TabsContent>
  )
}
