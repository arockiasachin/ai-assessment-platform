"use client"

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const percentConfig = {
  value: { label: "Average %", color: "var(--chart-1)" },
} satisfies ChartConfig

export function ClassAverageChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ChartContainer config={percentConfig} className="h-[260px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={0} angle={0} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ChartContainer>
  )
}

const distConfig = {
  count: { label: "Marks", color: "var(--chart-1)" },
} satisfies ChartConfig

const distColors = ["var(--chart-2)", "var(--chart-1)", "var(--chart-3)", "var(--chart-3)", "var(--chart-4)"]

export function GradeDistributionChart({ data }: { data: { grade: string; count: number }[] }) {
  return (
    <ChartContainer config={distConfig} className="h-[260px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="grade" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={32} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={64}>
          {data.map((entry, i) => (
            <Cell key={entry.grade} fill={distColors[i]} />
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
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval={0} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} width={40} />
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
