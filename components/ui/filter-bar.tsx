"use client"

import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type FilterOption = { value: string; label: string }

export type FilterSelect = {
  id: string
  label: string
  placeholder?: string
  /** Current value. Renders as the selection either way. */
  value: string
  options: FilterOption[]
  /**
   * Provide to make the select **controlled** — it fires on every change and the
   * caller owns the value. Omit for the original behaviour: the control renders
   * `value` and the user can move it, but nothing reacts.
   */
  onValueChange?: (value: string) => void
}

export type FilterBarProps = {
  searchLabel?: string
  searchPlaceholder?: string
  /**
   * Provide with `onSearchChange` to make the search box controlled. Omit for
   * the original behaviour: the box is labelled and typeable but inert.
   */
  searchValue?: string
  onSearchChange?: (value: string) => void
  selects?: FilterSelect[]
  /** Shown at the end of the bar, e.g. `14` + `submissions`. */
  resultCount?: number
  resultNoun?: string
  /**
   * Plural form, when appending `s` to `resultNoun` would be wrong.
   * Needed for any multi-word noun: `"item in the queue"` would otherwise
   * render as `"3 item in the queues"`. Defaults to `${resultNoun}s`.
   */
  resultNounPlural?: string
  /** Extra controls (a view toggle, an export button). */
  children?: React.ReactNode
  className?: string
}

/**
 * Standard list-page toolbar: search, labelled selects, and a result count.
 *
 * **Opt-in controlled.** Every control defaults to the original inert behaviour,
 * so the mockup pages that render it for composition keep working unchanged. Pass
 * `onSearchChange` / a select's `onValueChange` and that control becomes
 * controlled. The two modes are not mixed: a control is either inert or fully
 * controlled, never half-wired.
 *
 * The `items` prop on the `Select` root is not optional in spirit: Base UI's
 * `Select.Value` renders the raw value unless the root knows the value→label
 * map, which is how a filter ends up displaying `below-floor` instead of
 * `Below 78%`. Passing the same options array the popup renders keeps the
 * trigger and the menu in agreement by construction.
 */
export function FilterBar({
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  searchValue,
  onSearchChange,
  selects = [],
  resultCount,
  resultNoun = "result",
  resultNounPlural,
  children,
  className,
}: FilterBarProps) {
  const searchId = "filter-search"

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-52 sm:w-64">
          <Label htmlFor={searchId} className="sr-only">
            {searchLabel}
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              placeholder={searchPlaceholder}
              className="pl-8"
              // Controlled only when the caller supplies a handler; otherwise the
              // original uncontrolled behaviour is preserved exactly.
              {...(onSearchChange
                ? {
                    value: searchValue ?? "",
                    onChange: (event) => onSearchChange(event.target.value),
                  }
                : {})}
            />
          </div>
        </div>

        {selects.map((select) => (
          <div key={select.id} className="space-y-1">
            <Label htmlFor={select.id} className="text-xs text-muted-foreground">
              {select.label}
            </Label>
            {select.onValueChange ? (
              // Controlled: `value` + handler, so the caller owns the state.
              <Select
                value={select.value}
                onValueChange={(next) => select.onValueChange?.(next === null ? "" : String(next))}
                items={select.options}
              >
                <FilterSelectBody select={select} />
              </Select>
            ) : (
              // Inert: `defaultValue` so the user can still move the control, but
              // nothing reacts — this is the mockup behaviour.
              <Select defaultValue={select.value} items={select.options}>
                <FilterSelectBody select={select} />
              </Select>
            )}
          </div>
        ))}

        {children}
      </div>

      {typeof resultCount === "number" && (
        <p className="text-xs text-muted-foreground">
          {resultCount} {resultCount === 1 ? resultNoun : (resultNounPlural ?? `${resultNoun}s`)}
        </p>
      )}
    </div>
  )
}

/** The trigger and menu, shared by the controlled and uncontrolled branches. */
function FilterSelectBody({ select }: { select: FilterSelect }) {
  return (
    <>
      <SelectTrigger id={select.id} size="sm" className="w-full sm:w-44">
        <SelectValue placeholder={select.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {select.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </>
  )
}
