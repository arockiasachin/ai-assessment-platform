"use client"

import { Area, AreaChart } from "recharts"

import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

export type SparklineProps = {
  data: readonly number[]
  /** Accessible description, e.g. "Cohort average over the last six weeks". */
  label: string
  tone?: "primary" | "success" | "warning" | "destructive"
  className?: string
}

const TONE_COLOR: Record<NonNullable<SparklineProps["tone"]>, string> = {
  primary: "var(--chart-1)",
  success: "var(--chart-2)",
  warning: "var(--chart-3)",
  destructive: "var(--chart-4)",
}

/**
 * Compact trend shape for a `StatCard` slot.
 *
 * Axes, grid and tooltip are all removed (they would be noise at this size).
 * The chart is `aria-hidden` and the wrapper carries a `role="img"` label, so a
 * screen reader gets one clean sentence instead of a stray SVG.
 */
export function Sparkline({ data, label, tone = "primary", className }: SparklineProps) {
  const config = { value: { label, color: TONE_COLOR[tone] } } satisfies ChartConfig
  const chartData = data.map((value, index) => ({ index, value }))

  return (
    <span role="img" aria-label={label} className={cn("inline-block", className)}>
      <ChartContainer config={config} className="aspect-auto h-10 w-28" aria-hidden="true">
        <AreaChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Area
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            fill="var(--color-value)"
            fillOpacity={0.16}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </span>
  )
}
