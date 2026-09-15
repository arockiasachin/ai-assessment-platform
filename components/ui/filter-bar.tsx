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
  /** Pre-selected value — mockups render a realistic selection, inert. */
  value: string
  options: FilterOption[]
}

export type FilterBarProps = {
  searchLabel?: string
  searchPlaceholder?: string
  selects?: FilterSelect[]
  /** Shown at the end of the bar, e.g. `14` + `submissions`. */
  resultCount?: number
  resultNoun?: string
  /** Extra controls (a view toggle, an export button). */
  children?: React.ReactNode
  className?: string
}

/**
 * Standard list-page toolbar: search, labelled selects, and a result count.
 *
 * Inert by design — there is no state and no submit handler, so reviewers can
 * judge the composition without a data layer. Every control is still properly
 * labelled, so the a11y tree is unchanged once it is wired up.
 */
export function FilterBar({
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  selects = [],
  resultCount,
  resultNoun = "result",
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
            <Input id={searchId} type="search" placeholder={searchPlaceholder} className="pl-8" />
          </div>
        </div>

        {selects.map((select) => (
          <div key={select.id} className="space-y-1">
            <Label htmlFor={select.id} className="text-xs text-muted-foreground">
              {select.label}
            </Label>
            <Select defaultValue={select.value}>
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
            </Select>
          </div>
        ))}

        {children}
      </div>

      {typeof resultCount === "number" && (
        <p className="text-xs text-muted-foreground">
          {resultCount} {resultNoun}
          {resultCount === 1 ? "" : "s"}
        </p>
      )}
    </div>
  )
}
