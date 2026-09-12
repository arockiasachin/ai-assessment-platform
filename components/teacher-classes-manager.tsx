"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, Filter, GraduationCap, Save, Send, Users2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"

type OfferingRow = {
  id: string
  courseCode: string
  courseName: string
  className: string
  term: string
  academicYear: number
  studentLimit: number
  registrationOpenAt: string | null
  registrationCloseAt: string | null
  startsOn: string | null
  endsOn: string | null
  resultsPublishedAt: string | null
  retentionCutoff: string | null
  purgeEligible: boolean
  enrolledCount: number
  waitlistedCount: number
}

function toInputDate(value: string | null) {
  if (!value) return ""
  return value.slice(0, 10)
}

function toIso(value: string) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function TeacherClassesManager() {
  const [rows, setRows] = useState<OfferingRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        studentLimit: number
        registrationOpenAt: string
        registrationCloseAt: string
        startsOn: string
        endsOn: string
      }
    >
  >({})

  const load = async () => {
    try {
      const response = await fetch("/api/teacher/offerings", { cache: "no-store" })
      if (!response.ok) {
        setError("Unable to load classes.")
        return
      }
      const data = (await response.json()) as { offerings: OfferingRow[] }
      setRows(data.offerings)
      setDrafts(
        Object.fromEntries(
          data.offerings.map((row) => [
            row.id,
            {
              studentLimit: row.studentLimit,
              registrationOpenAt: toInputDate(row.registrationOpenAt),
              registrationCloseAt: toInputDate(row.registrationCloseAt),
              startsOn: toInputDate(row.startsOn),
              endsOn: toInputDate(row.endsOn),
            },
          ]),
        ),
      )
    } catch {
      setError("Unable to load classes.")
    } finally {
      setIsLoading(false)
    }
  }

  const refresh = async () => {
    setError(null)
    setIsLoading(true)
    await load()
  }

  useEffect(() => {
    void load()
  }, [])

  const summary = useMemo(
    () => ({
      totalSeats: rows.reduce((sum, row) => sum + row.studentLimit, 0),
      enrolledCount: rows.reduce((sum, row) => sum + row.enrolledCount, 0),
    }),
    [rows],
  )

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows

    return rows.filter((row) => {
      const haystack = [
        row.courseCode,
        row.courseName,
        row.className,
        row.term,
        String(row.academicYear),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [rows, search])

  const save = async (offeringId: string) => {
    const draft = drafts[offeringId]
    if (!draft) return

    setMessage(null)
    setSavingId(offeringId)
    try {
      const response = await fetch(`/api/teacher/offerings/${offeringId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentLimit: draft.studentLimit,
          registrationOpenAt: toIso(draft.registrationOpenAt),
          registrationCloseAt: toIso(draft.registrationCloseAt),
          startsOn: toIso(draft.startsOn),
          endsOn: toIso(draft.endsOn),
        }),
      })
      const data = (await response.json()) as { success?: boolean; message?: string }
      setMessage(data.message ?? (response.ok ? "Saved" : "Unable to save"))
      if (response.ok) {
        await refresh()
      }
    } catch {
      setMessage("Unable to save.")
    } finally {
      setSavingId(null)
    }
  }

  const publishResults = async (offeringId: string) => {
    setMessage(null)
    setPublishingId(offeringId)
    try {
      const response = await fetch(`/api/teacher/offerings/${offeringId}/results`, {
        method: "POST",
      })
      const data = (await response.json()) as { success?: boolean; message?: string }
      setMessage(data.message ?? (response.ok ? "Results published" : "Unable to publish results"))
      if (response.ok) {
        await refresh()
      }
    } catch {
      setMessage("Unable to publish results.")
    } finally {
      setPublishingId(null)
    }
  }

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading classes…</p>
  }

  if (error) {
    return <p className="py-10 text-center text-sm text-destructive">{error}</p>
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Only your assigned classes are shown</p>
            <p className="text-xs text-muted-foreground">
              This page is scoped to offerings where you are the assigned teacher.
            </p>
          </div>
          <Badge
            variant="outline"
            className="w-fit border-primary/30 bg-background/70 text-primary"
          >
            Teacher-owned offerings only
          </Badge>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base tracking-tight">Class control center</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm">
            <p className="text-xs text-muted-foreground">Offerings</p>
            <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold">
              <GraduationCap className="size-4 text-primary" />
              {rows.length}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm">
            <p className="text-xs text-muted-foreground">Active enrolled</p>
            <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold">
              <Users2 className="size-4 text-primary" />
              {summary.enrolledCount}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-sm">
            <p className="text-xs text-muted-foreground">Total capacity</p>
            <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold">
              <CalendarClock className="size-4 text-primary" />
              {summary.totalSeats}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="pt-6">
          <div className="relative max-w-md">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by course, class, term, or year"
              aria-label="Filter classes"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      {filteredRows.map((row) => {
        const draft = drafts[row.id]
        if (!draft) return null

        const fillPercent = Math.min(
          100,
          Math.round((row.enrolledCount / Math.max(draft.studentLimit, 1)) * 100),
        )

        return (
          <Card key={row.id} className="overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60 bg-muted/15">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{row.courseName}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.courseCode} · {row.className} · {row.term} {row.academicYear}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{row.enrolledCount} active</Badge>
                  <Badge variant="outline">{row.waitlistedCount} waitlist</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Capacity usage</span>
                  <span>{fillPercent}%</span>
                </div>
                <Progress value={fillPercent} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Student limit</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draft.studentLimit}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...prev[row.id],
                          studentLimit: Number(event.target.value),
                        },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Registration opens
                  </span>
                  <input
                    type="date"
                    value={draft.registrationOpenAt}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...prev[row.id],
                          registrationOpenAt: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Registration closes
                  </span>
                  <input
                    type="date"
                    value={draft.registrationCloseAt}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...prev[row.id],
                          registrationCloseAt: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Course starts</span>
                  <input
                    type="date"
                    value={draft.startsOn}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...prev[row.id],
                          startsOn: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Course ends</span>
                  <input
                    type="date"
                    value={draft.endsOn}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...prev[row.id],
                          endsOn: event.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                <p>
                  Active: <span className="font-semibold">{row.enrolledCount}</span> · Waitlist:{" "}
                  <span className="font-semibold">{row.waitlistedCount}</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {row.resultsPublishedAt ? (
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
                      Results published {row.resultsPublishedAt.slice(0, 10)}
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => publishResults(row.id)}
                      disabled={publishingId === row.id}
                    >
                      <Send className="size-4" />
                      Publish results
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => save(row.id)}
                    disabled={savingId === row.id}
                  >
                    <Save className="size-4" />
                    Save changes
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {filteredRows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No classes match this filter.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
