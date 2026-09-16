"use client"

import { useMemo } from "react"
import { Award, ClipboardList, Search, Sparkles, TrendingUp, Users } from "lucide-react"
import { AddAssessmentDialog } from "@/components/add-assessment-dialog"
import { ClassAverageChart, GradeDistributionChart } from "@/components/charts"
import { GradebookTable } from "@/components/gradebook-table"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/stat-card"
import { UpcomingEventsPanel } from "@/components/upcoming-events-panel"
import { useGradebook } from "@/components/gradebook-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  assessmentsWithAverage,
  classAverage,
  filterAssessments,
  gradeDistribution,
  passRate,
  studentAverage,
} from "@/lib/analytics"
import { round } from "@/lib/gradebook"

export function TeacherView() {
  const {
    students,
    courses,
    assessments,
    marks,
    upcomingEvents,
    isLoading,
    courseFilter,
    setCourseFilter,
    search,
    setSearch,
  } = useGradebook()

  const filtered = useMemo(
    () => filterAssessments(assessments, courseFilter),
    [assessments, courseFilter],
  )

  const summary = useMemo(
    () => ({
      avg: classAverage(marks, students, filtered),
      pass: passRate(marks, students, filtered),
    }),
    [marks, students, filtered],
  )

  const topStudent = useMemo(
    () =>
      students.reduce<{ name: string; pct: number } | null>((acc, s) => {
        const p = studentAverage(marks, s.id, filtered)
        if (p !== null && (acc === null || p > acc.pct)) return { name: s.name, pct: p }
        return acc
      }, null),
    [students, marks, filtered],
  )

  const classAvgData = useMemo(
    () =>
      // Assessments with no published mark are omitted, not charted as 0% — see
      // `assessmentsWithAverage`, which keeps "nothing marked yet" and "averaged zero" distinct.
      assessmentsWithAverage(marks, students, filtered).map(
        ({ assessment, average, position }) => ({
          label: `${assessment.title.length > 12 ? assessment.title.slice(0, 11) + "…" : assessment.title} ${position + 1}`,
          value: round(average),
        }),
      ),
    [filtered, marks, students],
  )

  const distData = useMemo(
    () => gradeDistribution(marks, students, filtered),
    [marks, students, filtered],
  )

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading gradebook…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge
              variant="outline"
              className="w-fit gap-1.5 border-primary/30 bg-background/70 text-primary"
            >
              <Sparkles className="size-3.5" />
              Teaching command center
            </Badge>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Class overview</h2>
              <p className="text-sm text-muted-foreground">
                Enter marks, monitor progress trends, and keep course activities on track.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AddAssessmentDialog />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Students"
          value={String(students.length)}
          sub="Enrolled"
          icon={Users}
          accent="primary"
        />
        <StatCard
          label="Class average"
          value={summary.avg === null ? "—" : `${round(summary.avg)}%`}
          sub={`${filtered.length} assessments`}
          icon={TrendingUp}
          accent="success"
        />
        <StatCard
          label="Pass rate"
          value={summary.pass === null ? "—" : `${round(summary.pass)}%`}
          sub="Marks at 60% or above"
          icon={ClipboardList}
          accent="warning"
        />
        <StatCard
          label="Top performer"
          value={topStudent ? `${round(topStudent.pct)}%` : "—"}
          sub={topStudent?.name ?? "No data"}
          icon={Award}
          accent="primary"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-4 xl:col-span-3">
          <UpcomingEventsPanel
            role="teacher"
            events={upcomingEvents}
            onFocusCourse={(courseId) => setCourseFilter(courseId)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8 xl:col-span-9">
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base tracking-tight">
                  Average score by assessment
                </CardTitle>
              </CardHeader>
              <CardContent>
                {classAvgData.length ? (
                  <ClassAverageChart data={classAvgData} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No assessments to show.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base tracking-tight">Grade distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <GradeDistributionChart data={distData} />
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/70 bg-card shadow-sm">
            <CardContent className="pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  {/*
                   * "Marks", not "Gradebook": this card is the marks grid, and its
                   * own description already says so. The old product name was
                   * retired (the header reads `BRAND.name`), so leaving it here
                   * made /teacher show "Rubrix" and "Gradebook" stacked.
                   */}
                  <h3 className="text-base font-semibold tracking-tight">Marks</h3>
                  <p className="text-xs text-muted-foreground">
                    Filter by course and search students to quickly update marks.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search students…"
                      aria-label="Search students"
                      className="pl-8 sm:w-56"
                    />
                  </div>
                  <Select
                    value={courseFilter}
                    onValueChange={(value) => setCourseFilter(value ?? "all")}
                  >
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
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-border/70 bg-card p-2 shadow-sm">
            <GradebookTable assessments={filtered} />
          </div>
        </div>
      </div>
    </div>
  )
}
