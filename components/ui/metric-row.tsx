import { cn } from "@/lib/utils"

export type MetricRowProps = {
  label: string
  value: React.ReactNode
  /** Small clarifying line under the label. */
  hint?: string
  className?: string
}

/**
 * One label/value line for a detail panel. Cheaper than a table and reads
 * correctly for a single record.
 */
export function MetricRow({ label, value, hint, className }: MetricRowProps) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

export type KeyValueItem = {
  id?: string
  label: string
  value: React.ReactNode
  hint?: string
}

/**
 * A description list for record metadata (IDs, timestamps, provenance).
 * Values are allowed to be `"—"` placeholders for genuinely missing data.
 */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {items.map((item, index) => (
        <div
          key={item.id ?? `${item.label}-${index}`}
          className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 py-2"
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm">
            {item.value}
            {item.hint && <p className="mt-0.5 text-xs text-muted-foreground">{item.hint}</p>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
