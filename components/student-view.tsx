"use client"

import { useMemo } from "react"
import { Award, BookOpen, Sparkles, Target, TrendingUp } from "lucide-react"
import { TrendChart } from "@/components/charts"
import { GradeBadge } from "@/components/grade-badge"
import { StatCard } from "@/components/stat-card"
import { UpcomingEventsPanel } from "@/components/upcoming-events-panel"
import { useGradebook } from "@/components/gradebook-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { filterAssessments, scorePct } from "@/lib/analytics"
import { courseLetter, formatDate, initials, round } from "@/lib/gradebook"

export function StudentView() {
  const {
    students,
    courses,
    assessments,
    marks,
    classAverages,
    upcomingEvents,
    isLoading,
    selectedStudentId,
    setSelectedStudentId,
    courseFilter,
    setCourseFilter,
  } = useGradebook()

  const filtered = useMemo(
    () => filterAssessments(assessments, courseFilter),
    [assessments, courseFilter],
  )
  const student = students.find((s) => s.id === selectedStudentId) ?? students[0] ?? null

  const assessmentStats = useMemo(
    () =>
      filtered.map((assessment) => ({
        assessment,
        pct: student ? scorePct(marks, student.id, assessment) : null,
        average: classAverages[assessment.id] ?? null,
      })),
    [filtered, marks, student, classAverages],
  )

  const classAvg = useMemo(() => {
    const vals = assessmentStats
      .map((entry) => entry.average)
      .filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((sum, value) => sum + value, 0) / vals.length : null
  }, [assessmentStats])

  const graded = useMemo(
    () => assessmentStats.filter((entry) => entry.pct !== null),
    [assessmentStats],
  )

  const overall = useMemo(() => {
    const vals = graded.map((entry) => entry.pct).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((sum, value) => sum + value, 0) / vals.length : null
  }, [graded])

  const best = useMemo(
    () =>
      graded.reduce<{ title: string; pct: number } | null>((acc, entry) => {
        if (entry.pct !== null && (acc === null || entry.pct > acc.pct)) {
          return { title: entry.assessment.title, pct: entry.pct }
        }
        return acc
      }, null),
    [graded],
  )

  const trendData = useMemo(
    () =>
      [...assessmentStats]
        .sort((a, b) => a.assessment.date.localeCompare(b.assessment.date))
        .map((entry) => ({
          label: formatDate(entry.assessment.date).replace(/,.*/, ""),
          value: entry.pct === null ? null : round(entry.pct),
          average: entry.average === null ? null : round(entry.average),
        })),
    [assessmentStats],
  )

  const delta = overall !== null && classAvg !== null ? overall - classAvg : null

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading gradebook…</p>
  }

  if (!student) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No students found.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 border border-primary/20">
              <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                {initials(student.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-background/70 px-2 py-1 text-xs font-medium text-primary">
                <Sparkles className="size-3.5" />
                Progress command center
              </div>
              <h2 className="text-xl font-semibold tracking-tight">{student.name}</h2>
              <p className="text-sm text-muted-foreground">{student.email}</p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select
              value={student.id}
              onValueChange={(value) => value && setSelectedStudentId(value)}
            >
              <SelectTrigger className="sm:w-52" aria-label="Selected student">
                <SelectValue placeholder="Select student" />
              </SelectTrigger>
              <SelectContent>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={courseFilter} onValueChange={(value) => setCourseFilter(value ?? "all")}>
              <SelectTrigger className="sm:w-44" aria-label="Filter by course">
                <SelectValue placeholder="All courses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All courses</SelectItem>
                {courses.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Overall average"
          value={overall === null ? "—" : `${round(overall)}%`}
          sub={overall === null ? "No marks yet" : `Grade ${courseLetter(overall)}`}
          icon={TrendingUp}
          accent="primary"
        />
        <StatCard
          label="vs Class average"
          value={delta === null ? "—" : `${delta >= 0 ? "+" : ""}${round(delta)}%`}
          sub={classAvg === null ? "No data" : `Class ${round(classAvg)}%`}
          icon={Target}
          accent={delta !== null && delta >= 0 ? "success" : "destructive"}
        />
        <StatCard
          label="Assessments"
          value={`${graded.length}/${filtered.length}`}
          sub="Graded"
          icon={BookOpen}
          accent="warning"
        />
        <StatCard
          label="Best result"
          value={best ? `${round(best.pct)}%` : "—"}
          sub={best?.title ?? "No data"}
          icon={Award}
          accent="success"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-4 xl:col-span-3">
          <UpcomingEventsPanel role="student" events={upcomingEvents} />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8 xl:col-span-9">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base tracking-tight">Performance over time</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length ? (
                <TrendChart data={trendData} showAverage />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No assessments to show.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/70 shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold">Assessment results</h3>
            </div>
            <ul className="divide-y divide-border/60">
              {assessmentStats.map((entry) => {
                const raw = marks[`${student.id}:${entry.assessment.id}`]
                return (
                  <li
                    key={entry.assessment.id}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.assessment.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.assessment.courseName} · {entry.assessment.type} ·{" "}
                        {formatDate(entry.assessment.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="font-mono text-sm tabular-nums text-muted-foreground">
                        {raw === undefined ? "—" : `${raw}/${entry.assessment.maxMarks}`}
                      </span>
                      <GradeBadge pct={entry.pct} />
                    </div>
                  </li>
                )
              })}
              {filtered.length === 0 && (
                <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No assessments to show.
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
