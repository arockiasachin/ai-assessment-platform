"use client"

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const percentConfig = {
  value: { label: "Average %", color: "var(--chart-1)" },
} satisfies ChartConfig

/** Build a screen-reader text alternative for a chart's data points. */
function describeData<T>(
  data: readonly T[],
  describe: (entry: T) => string,
  emptyText: string,
): string {
  if (data.length === 0) return emptyText
  return data.map(describe).join("; ")
}

export function ClassAverageChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ChartContainer config={percentConfig} className="h-[260px] w-full">
      <BarChart
        data={data}
        title="Average score by assessment"
        desc={describeData(
          data,
          (entry) => `${entry.label}: ${entry.value}%`,
          "No finalized attempts yet.",
        )}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          interval={0}
          angle={0}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          width={40}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ChartContainer>
  )
}

const distConfig = {
  count: { label: "Marks", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Colour per VIT band, keyed by letter rather than by array index.
 *
 * Keyed by letter because the order is meaningful — `S` is the best band and `F` the
 * worst — and an index-based palette would silently recolour the whole chart if a band
 * were ever added or removed. There are five chart variables for seven bands, so the
 * lower-passing bands share a colour deliberately rather than one falling out of range
 * and rendering an unfilled bar.
 */
const GRADE_COLORS: Record<string, string> = {
  S: "var(--chart-2)",
  A: "var(--chart-1)",
  B: "var(--chart-3)",
  C: "var(--chart-3)",
  D: "var(--chart-4)",
  E: "var(--chart-4)",
  F: "var(--chart-4)",
}

export function GradeDistributionChart({
  data,
  /**
   * What the bars are, for the title and the screen-reader description.
   *
   * Defaults to "marks", not "grades", because that is what the caller passes: the distribution
   * of **one assessment's marks** on VIT's absolute band boundaries. A VIT letter is awarded for
   * a *course grand total*, so calling these grades would claim a course grade per assessment —
   * the bands are a useful scale to bin marks against, and the wording has to say so or the
   * chart reads as something it is not.
   */
  noun = "marks",
}: {
  data: { grade: string; count: number }[]
  noun?: string
}) {
  return (
    <ChartContainer config={distConfig} className="h-[260px] w-full">
      <BarChart
        data={data}
        title={`Distribution of ${noun}`}
        desc={describeData(
          data,
          (entry) => `${entry.grade}: ${entry.count}`,
          "No finalized attempts to distribute.",
        )}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="grade" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
        <YAxis
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          width={32}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {data.map((entry) => (
            // Keyed by the band letter, not the array index, so adding or removing a
            // band cannot silently recolour the others.
            <Cell key={entry.grade} fill={GRADE_COLORS[entry.grade] ?? "var(--chart-5)"} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

const trendConfig = {
  value: { label: "Score %", color: "var(--chart-1)" },
  average: { label: "Class avg %", color: "var(--chart-3)" },
} satisfies ChartConfig

export function TrendChart({
  data,
  showAverage = false,
}: {
  data: { label: string; value: number | null; average?: number | null }[]
  showAverage?: boolean
}) {
  return (
    <ChartContainer config={trendConfig} className="h-[260px] w-full">
      <LineChart
        data={data}
        title="Score trend over time"
        desc={describeData(
          data,
          (entry) => {
            const score = entry.value === null ? "no score" : `${entry.value}%`
            const average =
              showAverage && entry.average != null ? `, class average ${entry.average}%` : ""
            return `${entry.label}: ${score}${average}`
          },
          "No assessments to show.",
        )}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          interval={0}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          width={40}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showAverage && (
          <Line
            dataKey="average"
            type="monotone"
            stroke="var(--color-average)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
          />
        )}
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--color-value)" }}
          activeDot={{ r: 5 }}
          connectNulls
        />
      </LineChart>
    </ChartContainer>
  )
}
