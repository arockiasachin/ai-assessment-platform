"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
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

const youVsClassConfig = {
  you: { label: "You", color: "var(--chart-1)" },
  average: { label: "Class average", color: "var(--chart-3)" },
} satisfies ChartConfig

/**
 * Two lines by assessment: the student's released mark and the disclosed class average.
 *
 * The personal line is **not** `connectNulls`: where the student has no released mark the
 * line breaks, because interpolating across it would draw a mark that does not exist. The
 * average line has no gaps — the caller only passes assessments whose average is disclosed.
 */
export function YouVsClassChart({
  data,
}: {
  data: { label: string; you: number | null; average: number }[]
}) {
  return (
    <ChartContainer config={youVsClassConfig} className="h-[260px] w-full">
      <LineChart
        data={data}
        title="Your marks against the class average"
        desc={describeData(
          data,
          (entry) =>
            `${entry.label}: you ${entry.you === null ? "no released mark" : `${entry.you}%`}, class average ${entry.average}%`,
          "No assessment has a disclosed class average yet.",
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
        <Line
          dataKey="average"
          type="monotone"
          stroke="var(--color-average)"
          strokeWidth={2}
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          dataKey="you"
          type="monotone"
          stroke="var(--color-you)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--color-you)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  )
}

const radarConfig = {
  mastery: { label: "Mastery %", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * Topic mastery on a radar — one axis per topic, weakest-first as the caller ordered them.
 *
 * The caller gates this on **three** topics: a radar with one or two axes is a shape that
 * does not mean anything. The axis label is bounded by the caller for legibility, while the
 * accessible description carries the full tag.
 */
export function TopicMasteryRadar({
  data,
}: {
  data: { label: string; topic: string; mastery: number }[]
}) {
  return (
    <ChartContainer config={radarConfig} className="mx-auto h-[320px] w-full">
      <RadarChart
        data={data}
        title="Topic mastery"
        desc={describeData(
          data,
          (entry) => `${entry.topic}: ${entry.mastery}%`,
          "No tagged questions to show.",
        )}
        margin={{ top: 16, right: 32, bottom: 16, left: 32 }}
      >
        <PolarGrid />
        <PolarAngleAxis
          dataKey="label"
          tickLine={false}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Radar
          dataKey="mastery"
          stroke="var(--color-mastery)"
          fill="var(--color-mastery)"
          fillOpacity={0.35}
          isAnimationActive={false}
        />
      </RadarChart>
    </ChartContainer>
  )
}

const GAUGE_FILL = {
  primary: "var(--chart-1)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--chart-4)",
} as const

/**
 * A single-value radial gauge: one arc of `value` out of `max`, with a centre figure.
 *
 * The arc is `aria-hidden` and the visible caption carries the number, so the figure is
 * available as text rather than only as an arc. `value` is clamped into `[0, max]` so a
 * total that overshoots the domain cannot draw outside its ring.
 */
export function RadialGauge({
  value,
  max = 100,
  centerValue,
  centerLabel,
  label,
  caption,
  tone = "primary",
}: {
  value: number
  max?: number
  /** Headline figure in the middle, e.g. "62.5%". */
  centerValue: string
  /** Small caption under the headline, e.g. "passed". */
  centerLabel?: string
  /** Accessible name for the arc. */
  label: string
  /** Visible sentence describing the number; must include it, since the arc is hidden. */
  caption: string
  tone?: keyof typeof GAUGE_FILL
}) {
  const clamped = Math.max(0, Math.min(value, max))
  return (
    <figure className="flex flex-wrap items-center gap-5">
      <div className="relative size-32 shrink-0" aria-hidden="true">
        <ChartContainer
          config={{ value: { label } }}
          className="aspect-auto size-32"
          aria-hidden="true"
        >
          <RadialBarChart
            data={[{ id: "value", value: clamped }]}
            innerRadius={44}
            outerRadius={62}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, max]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              background
              cornerRadius={6}
              fill={GAUGE_FILL[tone]}
              isAnimationActive={false}
            />
          </RadialBarChart>
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
      <figcaption className="min-w-40 flex-1 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

const differenceConfig = {
  difference: { label: "Difference", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * A diverging bar: one row per assessment, extending right above the class average and
 * left below it, with the zero line drawn so the sign is visually unambiguous.
 *
 * The colour is chosen per bar from the sign, not from the array index.
 */
export function DivergingBarChart({ data }: { data: { label: string; difference: number }[] }) {
  return (
    <ChartContainer config={differenceConfig} className="h-[260px] w-full">
      <BarChart
        data={data}
        layout="vertical"
        title="Above or below the class average"
        desc={describeData(
          data,
          (entry) => `${entry.label}: ${entry.difference > 0 ? "+" : ""}${entry.difference} points`,
          "No assessment has both a released mark and a disclosed class average.",
        )}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
          width={96}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ReferenceLine x={0} stroke="var(--border)" />
        <Bar dataKey="difference" radius={4} maxBarSize={24}>
          {data.map((entry, index) => (
            <Cell
              key={`${entry.label}-${index}`}
              fill={entry.difference >= 0 ? "var(--chart-2)" : "var(--chart-4)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
