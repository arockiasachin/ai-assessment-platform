"use client"

import { useCallback, useState } from "react"
import { AlertTriangle, Download, Loader2, RefreshCw, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
  AgsDryRunResponse,
  FinalGradeConfig,
  LmsExportFile,
  LmsOffering,
  TeacherGradeExportResponse,
} from "@/lib/contracts/lms-export"

/**
 * Teacher final-grade and LMS-export workspace.
 *
 * Computes weighted final grades from **published** grades only (the API
 * enforces this) and downloads the OneRoster 1.2-shaped CSV files. The LTI
 * button runs the in-memory dry run: it builds the AGS payloads but sends
 * nothing over the network.
 */

type Props = {
  offerings: LmsOffering[]
  initialOfferingId: string | null
  initialExport: TeacherGradeExportResponse | null
}

const FILES: { file: LmsExportFile; label: string }[] = [
  { file: "lineItems", label: "Line items" },
  { file: "results", label: "Results" },
  { file: "scoreScales", label: "Score scales" },
]

function offeringLabel(offering: LmsOffering): string {
  return `${offering.courseCode} — ${offering.courseName} (${offering.className}, ${offering.term})`
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`
}

export function TeacherLmsExport({ offerings, initialOfferingId, initialExport }: Props) {
  const [offeringId, setOfferingId] = useState(initialOfferingId ?? "")
  const [configText, setConfigText] = useState(
    initialExport ? JSON.stringify(initialExport.config, null, 2) : "",
  )
  const [data, setData] = useState<TeacherGradeExportResponse | null>(initialExport)
  const [lti, setLti] = useState<AgsDryRunResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseConfig = useCallback((): FinalGradeConfig | undefined => {
    const trimmed = configText.trim()
    if (trimmed.length === 0) return undefined
    const parsed: unknown = JSON.parse(trimmed)
    return parsed as FinalGradeConfig
  }, [configText])

  const compute = useCallback(async () => {
    if (!offeringId) return
    setBusy(true)
    setError(null)
    try {
      const config = parseConfig()
      const response = await fetch("/api/teacher/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId, config }),
        cache: "no-store",
      })
      const payload = (await response.json()) as TeacherGradeExportResponse & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? "Unable to compute final grades.")
      setData(payload)
      setLti(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to compute final grades.")
    } finally {
      setBusy(false)
    }
  }, [offeringId, parseConfig])

  const download = useCallback(
    async (file: LmsExportFile) => {
      if (!offeringId) return
      setBusy(true)
      setError(null)
      try {
        const config = parseConfig()
        const response = await fetch("/api/teacher/export/oneroster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offeringId, file, config }),
          cache: "no-store",
        })
        if (!response.ok) {
          const payload = (await response.json()) as { message?: string }
          throw new Error(payload.message ?? "Unable to build the export.")
        }
        const blob = await response.blob()
        const disposition = response.headers.get("content-disposition") ?? ""
        const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${file}.csv`
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (downloadError) {
        setError(downloadError instanceof Error ? downloadError.message : "Unable to export CSV.")
      } finally {
        setBusy(false)
      }
    },
    [offeringId, parseConfig],
  )

  const runLtiDryRun = useCallback(async () => {
    if (!offeringId) return
    setBusy(true)
    setError(null)
    try {
      const config = parseConfig()
      const response = await fetch("/api/teacher/export/lti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId, config }),
        cache: "no-store",
      })
      const payload = (await response.json()) as AgsDryRunResponse & { message?: string }
      if (!response.ok) throw new Error(payload.message ?? "LTI dry run failed.")
      setLti(payload)
    } catch (ltiError) {
      setLti(null)
      setError(ltiError instanceof Error ? ltiError.message : "LTI dry run failed.")
    } finally {
      setBusy(false)
    }
  }, [offeringId, parseConfig])

  const excludedCount =
    data?.students.reduce(
      (sum, student) => sum + student.excludedUnpublishedAssessmentIds.length,
      0,
    ) ?? 0
  const legacyCount =
    data?.students.reduce((sum, student) => sum + student.legacyFallbackAssessmentIds.length, 0) ??
    0

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final grade configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="export-offering"
              >
                Course offering
              </label>
              <Select value={offeringId} onValueChange={(value) => setOfferingId(value ?? "")}>
                <SelectTrigger id="export-offering">
                  <SelectValue placeholder="Select an offering" />
                </SelectTrigger>
                <SelectContent>
                  {offerings.map((offering) => (
                    <SelectItem key={offering.id} value={offering.id}>
                      {offeringLabel(offering)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" onClick={compute} disabled={busy || !offeringId}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Compute final grades
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="export-config">
              Category weights (JSON) — leave blank for equal weighting
            </label>
            <textarea
              id="export-config"
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
              rows={8}
              spellCheck={false}
              placeholder='{"categories":[{"id":"exams","name":"Exams","weight":60,"assessmentIds":["..."]},{"id":"coursework","name":"Coursework","weight":40,"assessmentIds":["..."]}]}'
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Weights are percentages and must sum to 100. An incoherent configuration is rejected
              with a 400 before any grade is computed.
            </p>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">OneRoster 1.2 export</CardTitle>
          <div className="flex flex-wrap gap-2">
            {FILES.map(({ file, label }) => (
              <Button
                key={file}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !offeringId}
                onClick={() => void download(file)}
              >
                <Download className="size-4" />
                {label}
              </Button>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || !offeringId}
              onClick={() => void runLtiDryRun()}
            >
              <Send className="size-4" />
              LTI AGS dry run
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Results include <strong>published</strong> grades only. A pending AI suggestion is
            excluded, never scored as zero. Legacy <code>AssessmentGrade</code> marks appear only
            where no modern <code>Grade</code> row exists.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">{data?.students.length ?? 0} students</Badge>
            <Badge variant="secondary">{data?.assessments.length ?? 0} assessments</Badge>
            <Badge variant={excludedCount > 0 ? "destructive" : "outline"}>
              {excludedCount} unpublished excluded
            </Badge>
            <Badge variant={legacyCount > 0 ? "destructive" : "outline"}>
              {legacyCount} legacy fallbacks
            </Badge>
            <Badge variant={data?.lti.configured ? "secondary" : "outline"}>
              LTI {data?.lti.configured ? "configured" : "not configured"}
            </Badge>
          </div>
          {lti && (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              Dry run: {lti.lineItems.length} line items, {lti.scores.length} scores,{" "}
              {lti.skippedUnpublished.length} unpublished skipped. No network calls were made.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weighted final grades</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.students.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Register no.</TableHead>
                  <TableHead className="text-right">Final</TableHead>
                  <TableHead className="text-right">Letter</TableHead>
                  <TableHead className="text-right">Completed weight</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.students.map((student) => (
                  <TableRow key={student.studentId}>
                    <TableCell className="font-medium">{student.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {student.registerNumber}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatPercent(student.percentage)}
                    </TableCell>
                    <TableCell className="text-right">{student.letter ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {student.completedWeight}/{student.totalWeight}
                    </TableCell>
                    <TableCell className="space-x-1">
                      {student.incomplete && <Badge variant="secondary">incomplete</Badge>}
                      {student.excludedUnpublishedAssessmentIds.length > 0 && (
                        <Badge variant="destructive">
                          {student.excludedUnpublishedAssessmentIds.length} unpublished
                        </Badge>
                      )}
                      {student.legacyFallbackAssessmentIds.length > 0 && (
                        <Badge variant="outline">
                          {student.legacyFallbackAssessmentIds.length} legacy
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an offering and compute final grades to see the cohort.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
