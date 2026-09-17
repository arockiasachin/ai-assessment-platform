"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3, Loader2 } from "lucide-react"

import { AnalyticsThresholdsPanel } from "@/components/analytics-thresholds-panel"
import { ClassAverageChart, GradeDistributionChart, TrendChart } from "@/components/charts"
import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  AnalyticsOfferingSummary,
  AssessmentItemAnalysisResponse,
  InterventionAlertValue,
  TeacherAnalyticsOverviewResponse,
  AnalyticsSettingsResponse,
} from "@/lib/contracts/analytics"
import { cohortTrendPoints, hasTrendData } from "@/lib/teacher-dashboard-view"

/**
 * Teacher analytics and intervention dashboard.
 *
 * Shows the cohort average/pass-rate per assessment, intervention alerts firing
 * on configurable thresholds, and per-question difficulty and discrimination
 * indices. Charts reuse `components/charts.tsx`; no answer key is ever part of
 * any payload this component reads.
 */

type Props = {
  offerings: AnalyticsOfferingSummary[]
  initialOfferingId: string | null
  initialOverview: TeacherAnalyticsOverviewResponse | null
  initialItems: AssessmentItemAnalysisResponse | null
  initialSettings: AnalyticsSettingsResponse | null
}

const SEVERITY_VARIANT: Record<
  InterventionAlertValue["severity"],
  "destructive" | "secondary" | "outline"
> = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`
}

function formatIndex(value: number | null): string {
  return value === null ? "Insufficient data" : value.toFixed(2)
}

export function TeacherAnalyticsDashboard({
  offerings,
  initialOfferingId,
  initialOverview,
  initialItems,
  initialSettings,
}: Props) {
  const [offeringId, setOfferingId] = useState(initialOfferingId ?? "")
  const [overview, setOverview] = useState<TeacherAnalyticsOverviewResponse | null>(initialOverview)
  const [items, setItems] = useState<AssessmentItemAnalysisResponse | null>(initialItems)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadItems = useCallback(async (assessmentId: string) => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/teacher/analytics/items?assessmentId=${encodeURIComponent(assessmentId)}`,
        { cache: "no-store" },
      )
      const data = (await response.json()) as AssessmentItemAnalysisResponse & { message?: string }
      if (!response.ok) throw new Error(data.message ?? "Unable to load item analysis.")
      setItems(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load item analysis.")
    } finally {
      setBusy(false)
    }
  }, [])

  const loadOverview = useCallback(
    async (id: string) => {
      setBusy(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/teacher/analytics?offeringId=${encodeURIComponent(id)}`,
          {
            cache: "no-store",
          },
        )
        const data = (await response.json()) as TeacherAnalyticsOverviewResponse & {
          message?: string
        }
        if (!response.ok) throw new Error(data.message ?? "Unable to load analytics.")
        setOverview(data)
        const firstWithData =
          data.assessments.find((assessment) => assessment.attemptCount > 0) ?? data.assessments[0]
        if (firstWithData) {
          await loadItems(firstWithData.id)
        } else {
          setItems(null)
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load analytics.")
      } finally {
        setBusy(false)
      }
    },
    [loadItems],
  )

  useEffect(() => {
    if (!offeringId || overview?.offeringId === offeringId) return
    // Defer to a task so the effect body does not call setState synchronously
    // (react-hooks/set-state-in-effect); the fetch still starts immediately.
    const handle = setTimeout(() => void loadOverview(offeringId), 0)
    return () => clearTimeout(handle)
  }, [offeringId, overview?.offeringId, loadOverview])

  const averageChartData = useMemo(
    () =>
      (overview?.assessments ?? [])
        .filter((assessment) => assessment.average !== null)
        .map((assessment) => ({
          label:
            assessment.title.length > 12 ? `${assessment.title.slice(0, 12)}…` : assessment.title,
          value: Math.round((assessment.average ?? 0) * 10) / 10,
        })),
    [overview],
  )

  const distributionData = useMemo(
    () =>
      (items?.cohort.buckets ?? []).map((bucket) => ({ grade: bucket.grade, count: bucket.count })),
    [items],
  )

  const selectedAssessment = useMemo(
    () =>
      overview?.assessments.find((assessment) => assessment.id === items?.assessment.id) ?? null,
    [overview, items],
  )

  return (
    <div className="space-y-6">
      {overview && <RegimeCallouts overview={overview} />}

      {/*
       * The thresholds editor. It sits above the charts because it governs them: the alerts and the
       * item-analysis withholds below are exactly what these numbers decide.
       */}
      {offeringId && (
        <AnalyticsThresholdsPanel offeringId={offeringId} initialPayload={initialSettings} />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4" /> Cohort overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={offeringId} onValueChange={(value) => setOfferingId(value ?? "")}>
              <SelectTrigger className="w-full sm:w-80" aria-label="Course offering">
                <SelectValue placeholder="Select an offering" />
              </SelectTrigger>
              <SelectContent>
                {offerings.map((offering) => (
                  <SelectItem key={offering.id} value={offering.id}>
                    {offering.courseCode} · {offering.className} · {offering.term}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {overview && (
            <p className="text-xs text-muted-foreground">
              Alerts use thresholds: class average &lt; {overview.thresholds.classAverageBelow}%,
              one member ≥ {(overview.thresholds.contributionShareAtLeast * 100).toFixed(0)}% of
              contribution weight, review queue ≥ {overview.thresholds.pendingReviewsAtLeast}.
            </p>
          )}
        </CardContent>
      </Card>

      {overview && overview.alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" /> Intervention alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.alerts.map((alert, index) => (
              <div
                key={`${alert.type}-${index}`}
                className="flex flex-col gap-1 rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</Badge>
                  <span className="text-sm font-medium">{alert.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{alert.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/*
        The payload has always carried the at-risk roster and the weekly series; the page
        simply never rendered them, so the "At risk" tile was a dead end and both reads ran
        for nothing (TN-6). Both are rendered here from the same overview the rest of the
        page uses — no second fetch.
      */}
      {overview && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">At-risk students</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.atRisk.atRisk.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No student is below the pass line, and every enrolled student has a published
                  total.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {overview.atRisk.atRisk.length} of {overview.atRisk.enrolledCount} enrolled ·{" "}
                    {overview.atRisk.aboveBoundaryCount} above the pass line ·{" "}
                    {overview.atRisk.publishedCount} with a published total
                    {overview.atRisk.boundary !== null
                      ? ` · pass line ${formatPercent(overview.atRisk.boundary)}`
                      : ""}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Register number</TableHead>
                        <TableHead>Grand total</TableHead>
                        <TableHead>Why</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.atRisk.atRisk.map((student) => (
                        <TableRow key={student.studentId}>
                          <TableCell className="max-w-[14rem] truncate">
                            {student.fullName}
                          </TableCell>
                          <TableCell>{student.registerNumber}</TableCell>
                          <TableCell>{formatPercent(student.grandTotal)}</TableCell>
                          <TableCell>
                            {student.group === "below-boundary" ? (
                              <Badge variant="destructive">Below the pass line</Badge>
                            ) : (
                              <Badge variant="secondary">No published work</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cohort trend</CardTitle>
            </CardHeader>
            <CardContent>
              {overview.trend.series === null ? (
                <p className="text-sm text-muted-foreground">
                  This offering has no term window, so there is no axis to bucket the cohort&apos;s
                  marks against.
                </p>
              ) : hasTrendData(overview.trend.series) ? (
                <>
                  <TrendChart data={cohortTrendPoints(overview.trend.series)} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Mean score by teaching week · {overview.trend.series.weeks} teaching weeks ·{" "}
                    {overview.trend.markedCount} released marks. A week with no assessed work is
                    left blank.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No released marks fall inside the term window yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {overview && overview.assessments.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Average by assessment</CardTitle>
            </CardHeader>
            <CardContent>
              {averageChartData.length > 0 ? (
                <ClassAverageChart data={averageChartData} />
              ) : (
                <p className="text-sm text-muted-foreground">No finalized attempts yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assessments</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Average</TableHead>
                    <TableHead>Pass rate</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.assessments.map((assessment) => (
                    <TableRow key={assessment.id}>
                      <TableCell className="max-w-[16rem] truncate">{assessment.title}</TableCell>
                      <TableCell>{assessment.attemptCount}</TableCell>
                      <TableCell>{formatPercent(assessment.average)}</TableCell>
                      <TableCell>{formatPercent(assessment.passRate)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void loadItems(assessment.id)}
                        >
                          Item analysis
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {items && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Score distribution · {selectedAssessment?.title ?? items.assessment.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {items.cohort.count > 0 ? (
                <>
                  <GradeDistributionChart data={distributionData} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {items.cohort.count} finalized attempt(s) · average{" "}
                    {formatPercent(items.cohort.average)} · pass rate{" "}
                    {formatPercent(items.cohort.passRate)} (≥ {items.cohort.passThreshold}%). Bars
                    bin this assessment&apos;s marks on VIT&apos;s absolute scale; a VIT letter is
                    awarded for a course grand total, not for one assessment.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No finalized attempts yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Item analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Correct</TableHead>
                    <TableHead>Difficulty</TableHead>
                    <TableHead>Discrimination</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.items.map((item) => (
                    <TableRow key={item.questionId}>
                      <TableCell>{item.questionOrder}</TableCell>
                      <TableCell>
                        {item.correctCount}/{item.answeredCount}
                        {item.unansweredCount > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (+{item.unansweredCount} blank)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{formatIndex(item.difficultyIndex)}</TableCell>
                      <TableCell>{formatIndex(item.discriminationIndex)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Difficulty is 0 (easiest) to 1 (hardest). Discrimination is the 27% extreme-groups
                index (−1 to 1). With fewer than {items.thresholds.minAttemptsForDifficulty}{" "}
                answered responses or {items.thresholds.minAttemptsForDiscrimination} scored
                responses an index is reported as insufficient data instead of a misleading number.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

/**
 * The grading regime, and the explanation when it is a fallback.
 *
 * Rendered above every other card because it **qualifies every number below it**: the cohort
 * distribution and the pass rate are absolute-band figures, and a relative-graded class shown
 * them with no explanation would look like a correct grade that happens to be wrong. For a
 * relative class the mean and sigma are stated instead, so the bands on screen are visibly the
 * class's own rather than a fixed table.
 */
function RegimeCallouts({ overview }: { overview: TeacherAnalyticsOverviewResponse }) {
  const regime = overview.gradingRegime

  if (regime.notice) {
    return (
      <Callout tone={regime.notice.tone} title={regime.notice.title} icon={AlertTriangle}>
        <p>{regime.notice.detail}</p>
        {regime.notice.progress && (
          <p className="mt-1 font-mono text-xs tabular-nums">
            {regime.notice.progress.available} of {regime.notice.progress.required} published totals
          </p>
        )}
      </Callout>
    )
  }

  if (regime.regime === "relative") {
    return (
      <Callout tone="info" title="Graded on relative bands" icon={BarChart3}>
        <p>
          Class mean {formatPercent(regime.mean)} · standard deviation{" "}
          {formatPercent(regime.standardDeviation)}, over {regime.publishedCount} published totals.
          Bands are this class&apos;s own mean ± kσ, so the pass line is{" "}
          {formatPercent(overview.atRisk.boundary)}.
        </p>
      </Callout>
    )
  }

  return null
}
