"use client"

import { useEffect, useMemo, useState } from "react"
import { BookOpenCheck, Calendar, ChevronDown, Search, Sparkles, Star, Users } from "lucide-react"
import type { CourseCatalogItem, StudentCoursesPayload } from "@/lib/student-courses"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function formatDate(value: string | null) {
  if (!value) return "Not set"
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusLabel(course: CourseCatalogItem) {
  if (course.registrationStatus === "enrolled") return "Enrolled"
  if (course.registrationStatus === "waitlisted") return "Waitlisted"
  if (course.registrationStatus === "open") return "Registration open"
  if (course.registrationStatus === "upcoming") return "Registration opens soon"
  if (course.registrationStatus === "full") return "Class full"
  return "Registration closed"
}

// The app themes via `prefers-color-scheme`, so the `.dark`-scoped Tailwind
// `dark:` variant never activates; the explicit media variant keeps the status
// chip readable on a dark page.
function statusClass(status: CourseCatalogItem["registrationStatus"]) {
  if (status === "open")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
  if (status === "enrolled") return "border-primary/40 bg-primary/10 text-primary"
  if (status === "waitlisted")
    return "border-orange-500/30 bg-orange-500/10 text-orange-700 [@media(prefers-color-scheme:dark)]:text-orange-400"
  if (status === "upcoming")
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 [@media(prefers-color-scheme:dark)]:text-sky-400"
  if (status === "full")
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 [@media(prefers-color-scheme:dark)]:text-amber-400"
  return "border-border bg-muted text-muted-foreground"
}

export function StudentCoursesView() {
  const [payload, setPayload] = useState<StudentCoursesPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [pendingOffer, setPendingOffer] = useState<string | null>(null)
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, number>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})

  const loadCourses = async () => {
    try {
      const response = await fetch("/api/student/courses", { cache: "no-store" })
      if (!response.ok) {
        setError("Unable to load courses right now.")
        return
      }
      const data = (await response.json()) as StudentCoursesPayload
      setPayload(data)
    } catch {
      setError("Unable to load courses right now.")
    } finally {
      setIsLoading(false)
    }
  }

  const refreshCourses = async () => {
    setError(null)
    setIsLoading(true)
    await loadCourses()
  }

  useEffect(() => {
    void loadCourses()
  }, [])

  const offeredFiltered = useMemo(() => {
    const list = payload?.offeredCourses ?? []
    const query = search.trim().toLowerCase()
    if (!query) return list
    return list.filter((course) => {
      const text = `${course.courseCode} ${course.courseName} ${course.teacherName}`.toLowerCase()
      return text.includes(query)
    })
  }, [payload, search])

  const enrolled = useMemo(() => payload?.enrolledCourses ?? [], [payload])

  const summary = useMemo(
    () => ({
      enrolledCount: enrolled.length,
      openCount: (payload?.offeredCourses ?? []).filter(
        (course) => course.registrationStatus === "open",
      ).length,
      completedCount: enrolled.filter((course) => course.isCompleted).length,
    }),
    [enrolled, payload],
  )

  const toggleExpanded = (offeringId: string) => {
    setExpanded((prev) => ({ ...prev, [offeringId]: !prev[offeringId] }))
  }

  const enroll = async (offeringId: string) => {
    setPendingOffer(offeringId)
    setMessage(null)
    try {
      const response = await fetch("/api/student/courses/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId }),
      })
      const data = (await response.json()) as { success?: boolean; message?: string }
      setMessage(data.message ?? (response.ok ? "Enrollment updated." : "Unable to enroll."))
      if (response.ok) {
        await refreshCourses()
      }
    } catch {
      setMessage("Unable to enroll right now.")
    } finally {
      setPendingOffer(null)
    }
  }

  const submitRating = async (offeringId: string) => {
    const rating = ratingDrafts[offeringId]
    const comment = (commentDrafts[offeringId] ?? "").trim()
    if (!rating || rating < 1 || rating > 5) return

    setPendingOffer(offeringId)
    setMessage(null)
    try {
      const response = await fetch("/api/student/courses/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId, rating, comment }),
      })
      const data = (await response.json()) as { success?: boolean; message?: string }
      setMessage(data.message ?? (response.ok ? "Rating saved." : "Unable to save rating."))
      if (response.ok) {
        await refreshCourses()
      }
    } catch {
      setMessage("Unable to save rating right now.")
    } finally {
      setPendingOffer(null)
    }
  }

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading courses…</p>
  }

  if (error || !payload) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error ?? "Unable to load courses."}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-background/70 px-2 py-1 text-xs font-medium text-primary">
              <Sparkles className="size-3.5" />
              Course workspace
            </div>
            <p className="text-sm font-semibold">
              Manage enrollments, monitor class capacity, and rate completed courses
            </p>
            <p className="text-xs text-muted-foreground">
              Everything here updates directly from your student record.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs sm:gap-3">
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Enrolled</p>
              <p className="font-semibold text-foreground">{summary.enrolledCount}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Open now</p>
              <p className="font-semibold text-foreground">{summary.openCount}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Completed</p>
              <p className="font-semibold text-foreground">{summary.completedCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          {message}
        </div>
      )}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <BookOpenCheck className="size-4 text-primary" />
            My course registrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {enrolled.map((course) => {
            const isExpanded = Boolean(expanded[course.offeringId])
            const ratingValue = ratingDrafts[course.offeringId] ?? course.studentRating
            const commentValue =
              commentDrafts[course.offeringId] ?? course.studentRatingComment ?? ""

            return (
              <div
                key={course.offeringId}
                className="rounded-xl border border-border/70 bg-background shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => toggleExpanded(course.offeringId)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{course.courseName}</p>
                    <p className="text-xs text-muted-foreground">
                      {course.courseCode} · {course.term} {course.academicYear}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        "rounded-md border px-2 py-1 text-xs font-medium",
                        statusClass(course.registrationStatus),
                      ].join(" ")}
                    >
                      {statusLabel(course)}
                    </span>
                    <ChevronDown
                      className={[
                        "size-4 transition-transform",
                        isExpanded ? "rotate-180" : "",
                      ].join(" ")}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/70 px-4 py-3 text-sm">
                    <p className="mb-3 text-muted-foreground">
                      {course.description ?? "No description available."}
                    </p>
                    <div className="grid gap-2 text-[13px] sm:grid-cols-2 sm:text-sm">
                      <p>
                        <span className="font-medium">Teacher:</span> {course.teacherName}
                      </p>
                      <p>
                        <span className="font-medium">Credits:</span> {course.credits}
                      </p>
                      <p>
                        <span className="font-medium">Students enrolled:</span>{" "}
                        {course.enrolledCount}/{course.studentLimit}
                      </p>
                      <p>
                        <span className="font-medium">Waitlist:</span> {course.waitlistedCount}
                      </p>
                      <p>
                        <span className="font-medium">Class:</span> {course.className}
                      </p>
                      <p>
                        <span className="font-medium">Start date:</span>{" "}
                        {formatDate(course.startsOn)}
                      </p>
                      <p>
                        <span className="font-medium">End date:</span> {formatDate(course.endsOn)}
                      </p>
                      <p>
                        <span className="font-medium">Registration opens:</span>{" "}
                        {formatDate(course.registrationOpenAt)}
                      </p>
                      <p>
                        <span className="font-medium">Registration closes:</span>{" "}
                        {formatDate(course.registrationCloseAt)}
                      </p>
                      <p>
                        <span className="font-medium">Average rating:</span>{" "}
                        {course.averageRating !== null
                          ? `${course.averageRating.toFixed(1)} / 5`
                          : "No ratings"}
                      </p>
                      <p>
                        <span className="font-medium">Your rating:</span>{" "}
                        {course.studentRating !== null
                          ? `${course.studentRating} / 5`
                          : "Not rated"}
                      </p>
                    </div>

                    {course.isCompleted && (
                      <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                        <div className="space-y-1">
                          <label
                            className="text-xs font-medium text-muted-foreground"
                            htmlFor={`rating-${course.offeringId}`}
                          >
                            Rate this course
                          </label>
                          <Select
                            value={ratingValue === null ? null : String(ratingValue)}
                            onValueChange={(value) =>
                              setRatingDrafts((prev) => ({
                                ...prev,
                                [course.offeringId]: Number(value),
                              }))
                            }
                          >
                            <SelectTrigger
                              id={`rating-${course.offeringId}`}
                              aria-label={`Rating for ${course.courseName}`}
                            >
                              <SelectValue placeholder="Select a rating" />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 2, 3, 4, 5].map((value) => (
                                <SelectItem key={value} value={String(value)}>
                                  {value} / 5
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <textarea
                          value={commentValue}
                          onChange={(e) =>
                            setCommentDrafts((prev) => ({
                              ...prev,
                              [course.offeringId]: e.target.value,
                            }))
                          }
                          aria-label={`Comment about ${course.courseName}`}
                          placeholder="Optional comment about the course"
                          className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          maxLength={500}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => submitRating(course.offeringId)}
                          disabled={pendingOffer === course.offeringId}
                        >
                          <Star className="size-4" />
                          Save rating
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {enrolled.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You are not enrolled in any courses yet.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Explore all offered courses</CardTitle>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-8"
              aria-label="Search courses"
              placeholder="Search by course name, code, or teacher"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {offeredFiltered.map((course) => (
            <div
              key={course.offeringId}
              className="rounded-xl border border-border/70 bg-background px-4 py-3 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{course.courseName}</p>
                  <p className="text-xs text-muted-foreground">
                    {course.courseCode} · {course.term} {course.academicYear} · {course.teacherName}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" /> {course.enrolledCount}/{course.studentLimit}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3.5" /> {formatDate(course.registrationOpenAt)} to{" "}
                      {formatDate(course.registrationCloseAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={[
                      "rounded-md border px-2 py-1 text-xs font-medium",
                      statusClass(course.registrationStatus),
                    ].join(" ")}
                  >
                    {statusLabel(course)}
                  </span>
                  {!course.isEnrolled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => enroll(course.offeringId)}
                      disabled={
                        course.isWaitlisted ||
                        (!course.canRegister && course.registrationStatus !== "full") ||
                        pendingOffer === course.offeringId
                      }
                    >
                      {course.registrationStatus === "full"
                        ? "Join waitlist"
                        : course.isWaitlisted
                          ? "Waitlisted"
                          : "Register"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {offeredFiltered.length === 0 && (
            <p className="text-sm text-muted-foreground">No courses match your search.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
