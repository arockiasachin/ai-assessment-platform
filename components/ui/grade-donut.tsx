"use client"

import { Cell, Pie, PieChart } from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

export type GradeDonutSlice = {
  /** Stable key; also the chart-config key that carries the colour. */
  id: string
  label: string
  value: number
}

export type GradeDonutProps = {
  slices: GradeDonutSlice[]
  /** Headline number in the middle, e.g. "78%". */
  centerValue: string
  /** Small caption under the headline, e.g. "cohort mean". */
  centerLabel?: string
  /** Accessible description of the whole chart. */
  label: string
  className?: string
}

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

/**
 * Donut for a small categorical split (grade bands, status mix) with a headline
 * figure in the middle and a readable legend beside it.
 *
 * The ring itself is `aria-hidden`; the legend list and the visually hidden
 * summary carry the meaning, so the numbers are available to screen readers as
 * text rather than as an inaccessible graphic.
 */
export function GradeDonut({
  slices,
  centerValue,
  centerLabel,
  label,
  className,
}: GradeDonutProps) {
  const config: ChartConfig = Object.fromEntries(
    slices.map((slice, index) => [
      slice.id,
      { label: slice.label, color: SLICE_COLORS[index % SLICE_COLORS.length] },
    ]),
  )
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const summary = slices.map((slice) => `${slice.label}: ${slice.value}`).join("; ")

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <div className="relative size-32 shrink-0">
        <ChartContainer config={config} className="aspect-auto size-32" aria-hidden="true">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={44}
              outerRadius={62}
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.id} fill={`var(--color-${slice.id})`} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-lg font-semibold tabular-nums">{centerValue}</span>
          {centerLabel && (
            <span className="text-[0.65rem] tracking-wider text-muted-foreground uppercase">
              {centerLabel}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-40 flex-1">
        <p className="sr-only">
          {label} — {summary}
        </p>
        <ul className="space-y-1.5 text-sm">
          {slices.map((slice, index) => (
            <li key={slice.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
              />
              <span className="flex-1 text-muted-foreground">{slice.label}</span>
              <span className="font-mono tabular-nums">{slice.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{total} total</p>
      </div>
    </div>
  )
}
