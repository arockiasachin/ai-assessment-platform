"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpenCheck, CalendarClock, CheckCheck, Search, Star, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { GradeDonut } from "@/components/ui/grade-donut"
import { Label } from "@/components/ui/label"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import type {
  CourseCatalogItem,
  CourseRegistrationStatus,
  StudentCoursesPayload,
} from "@/lib/student-courses"

/**
 * Student course workspace.
 *
 * Every row comes from the server: the page passes the payload in as a prop and
 * this component never fetches on mount. The two writes it does own — enrolling
 * and rating — call `router.refresh()` afterwards, so the page's `force-dynamic`
 * server component re-runs and the updated catalog arrives as fresh props. There
 * is deliberately no client re-fetch of data the server already has.
 *
 * Ratings are shown in aggregate only (average + distribution + the student's
 * own row); a classmate's name and comment are never requested or rendered
 * (`docs/plans/wave-1.md` D7, `docs/features/course-ratings.md`).
 */

type Props = { initialPayload: StudentCoursesPayload }

/**
 * Dates are formatted in UTC with an explicit locale, matching `lib/mock/format.ts`.
 * Without the pinned time zone the server render (UTC) and the browser render
 * (the visitor's zone) can disagree about the day, which is a hydration error —
 * this repo has already shipped one.
 */
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—"
}

/** `null` is "not rated yet", so it renders as an em dash — never as `0`. */
function formatAverageRating(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)} / 5`
}

function formatOwnRating(value: number | null): string {
  return value === null ? "—" : `${value} / 5`
}

const RATING_OPTIONS = [5, 4, 3, 2, 1].map((value) => ({
  value: String(value),
  label: `${value} / 5`,
}))

/**
 * Registration state → the shared status vocabulary.
 *
 * The vocabulary is closed, so the keys are chosen for their tone and the label
 * is always the course-domain word: `graded` carries the success tone an open
 * window should read as, and `pending` covers both "waiting for a seat" and
 * "class full".
 */
const REGISTRATION_STATUS: Record<CourseRegistrationStatus, { key: StatusKey; label: string }> = {
  enrolled: { key: "active", label: "Enrolled" },
  waitlisted: { key: "pending", label: "Waitlisted" },
  open: { key: "graded", label: "Registration open" },
  upcoming: { key: "published", label: "Opens soon" },
  full: { key: "pending", label: "Class full" },
  closed: { key: "archived", label: "Closed" },
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Registration open" },
  { value: "upcoming", label: "Opens soon" },
  { value: "full", label: "Class full" },
  { value: "closed", label: "Closed" },
  { value: "enrolled", label: "Enrolled" },
  { value: "waitlisted", label: "Waitlisted" },
]

const CATALOG_COLUMNS: Column<CourseCatalogItem>[] = [
  {
    id: "course",
    header: "Course",
    className: "whitespace-normal",
    cell: (course) => (
      <div className="min-w-0">
        <p className="font-medium">{course.courseName}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{course.courseCode}</span> · {course.term}{" "}
          {course.academicYear} · {course.className}
        </p>
      </div>
    ),
  },
  {
    id: "teacher",
    header: "Teacher",
    hideBelow: "sm",
    cell: (course) => course.teacherName,
  },
  {
    id: "seats",
    header: "Seats",
    align: "right",
    hideBelow: "sm",
    cell: (course) => (
      <span className="font-mono tabular-nums">
        {course.enrolledCount} / {course.studentLimit}
      </span>
    ),
  },
  {
    id: "registration",
    header: "Registration",
    cell: (course) => {
      const meta = REGISTRATION_STATUS[course.registrationStatus]
      return <StatusPill status={meta.key} label={meta.label} dot />
    },
  },
  {
    id: "window",
    header: "Window",
    hideBelow: "lg",
    cell: (course) => (
      <span className="font-mono text-xs tabular-nums">
        {formatDate(course.registrationOpenAt)} → {formatDate(course.registrationCloseAt)}
      </span>
    ),
  },
]

export function StudentCoursesView({ initialPayload }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<CourseRegistrationStatus | "all">("all")
  const [ratingDrafts, setRatingDrafts] = useState<Record<string, number>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enrolled = initialPayload.enrolledCourses
  const offered = initialPayload.offeredCourses

  const filteredOffered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return offered.filter((course) => {
      if (statusFilter !== "all" && course.registrationStatus !== statusFilter) return false
      if (!query) return true
      const text = `${course.courseCode} ${course.courseName} ${course.teacherName} ${course.className}`
      return text.toLowerCase().includes(query)
    })
  }, [offered, search, statusFilter])

  const activeCount = enrolled.filter((course) => course.isEnrolled).length
  const waitlistedCount = enrolled.filter((course) => course.isWaitlisted).length
  const openCount = offered.filter((course) => course.registrationStatus === "open").length
  // Rateable means finished *and* actively enrolled: the rating route rejects a
  // waitlisted enrollment with 403, so the form must not appear for one.
  const rateable = enrolled.filter((course) => course.isEnrolled && course.isCompleted)

  async function enroll(offeringId: string) {
    setPendingId(offeringId)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/student/courses/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId }),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to enroll right now.")
        return
      }
      setMessage(data.message ?? "Enrollment updated.")
      router.refresh()
    } catch {
      setError("Unable to enroll right now.")
    } finally {
      setPendingId(null)
    }
  }

  async function submitRating(course: CourseCatalogItem) {
    const rating = ratingDrafts[course.offeringId] ?? course.studentRating
    if (rating === null || rating === undefined || rating < 1 || rating > 5) {
      setError("Choose a rating from 1 to 5 before saving.")
      return
    }
    const comment = (commentDrafts[course.offeringId] ?? course.studentRatingComment ?? "").trim()

    setPendingId(course.offeringId)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/student/courses/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId: course.offeringId, rating, comment }),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to save rating right now.")
        return
      }
      setMessage(data.message ?? "Rating saved.")
      router.refresh()
    } catch {
      setError("Unable to save rating right now.")
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Every tile derives from the payload the server sent, so none can
          contradict the lists below. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Enrolled"
          value={String(activeCount)}
          hint="Active registrations"
          icon={BookOpenCheck}
        />
        <StatCard
          label="Waitlisted"
          value={String(waitlistedCount)}
          hint="Waiting for a seat"
          icon={UserPlus}
        />
        <StatCard
          label="Open to register"
          value={String(openCount)}
          hint="Registration window is open"
          icon={CalendarClock}
        />
        <StatCard
          label="Completed"
          value={String(rateable.length)}
          hint="Ready to rate"
          icon={CheckCheck}
        />
      </div>

      {message && (
        <div role="status">
          <Callout tone="success" title="Saved">
            {message}
          </Callout>
        </div>
      )}
      {error && (
        <div role="alert">
          <Callout tone="destructive" title="Something went wrong">
            {error}
          </Callout>
        </div>
      )}

      <SectionCard
        title="My courses"
        description="Every offering you are enrolled in or waitlisted for, current term and past."
      >
        {enrolled.length === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title="No registrations yet"
            description="Register for an offering from the catalog below and it will appear here."
          />
        ) : (
          <div className="grid gap-4">
            {enrolled.map((course) => {
              const registration = REGISTRATION_STATUS[course.registrationStatus]
              return (
                <div key={course.offeringId} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-medium">{course.courseName}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{course.courseCode}</span> · {course.term}{" "}
                        {course.academicYear} · {course.className}
                      </p>
                    </div>
                    <StatusPill status={registration.key} label={registration.label} dot />
                  </div>

                  {course.description && (
                    <p className="mt-3 text-sm text-muted-foreground text-pretty">
                      {course.description}
                    </p>
                  )}

                  <KeyValueList
                    className="mt-2"
                    items={[
                      { label: "Teacher", value: course.teacherName },
                      { label: "Credits", value: `${course.credits} credits` },
                      {
                        label: "Runs",
                        value: (
                          <span className="font-mono text-xs tabular-nums">
                            {formatDate(course.startsOn)} → {formatDate(course.endsOn)}
                          </span>
                        ),
                      },
                      {
                        label: "Enrollment",
                        value: (
                          <span className="font-mono tabular-nums">
                            {course.enrolledCount} / {course.studentLimit}
                          </span>
                        ),
                        hint:
                          course.waitlistedCount > 0
                            ? `${course.waitlistedCount} on the waitlist`
                            : undefined,
                      },
                    ]}
                  />
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Course feedback"
        description="How each finished course was rated, in aggregate."
      >
        <div className="grid gap-4">
          <Callout tone="info" title="Ratings stay anonymous">
            You see the average, the distribution, and your own rating. A classmate&apos;s name and
            comment are never shown to students.
          </Callout>

          {rateable.length === 0 ? (
            <EmptyState
              icon={Star}
              title="Nothing to rate yet"
              description="A course can be rated once it has finished and you were enrolled in it."
            />
          ) : (
            rateable.map((course) => {
              const slices = course.ratingDistribution
                .map((bucket) => ({
                  id: `stars-${bucket.stars}`,
                  label: bucket.stars === 1 ? "1 star" : `${bucket.stars} stars`,
                  value: bucket.count,
                }))
                .filter((slice) => slice.value > 0)
              const draftRating = ratingDrafts[course.offeringId]
              const ratingValue = draftRating ?? course.studentRating
              const commentValue =
                commentDrafts[course.offeringId] ?? course.studentRatingComment ?? ""
              const isSaving = pendingId === course.offeringId

              return (
                <div key={course.offeringId} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-medium">{course.courseName}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{course.courseCode}</span> · {course.term}{" "}
                        {course.academicYear}
                      </p>
                    </div>
                    <StatusPill status="completed" />
                  </div>

                  <div className="mt-4 grid gap-4">
                    {course.ratingsCount === 0 ? (
                      <EmptyState
                        size="sm"
                        title="No ratings yet"
                        description="No student has rated this course so far."
                      />
                    ) : (
                      <GradeDonut
                        slices={slices}
                        centerValue={formatAverageRating(course.averageRating)}
                        centerLabel="average"
                        label={`Distribution of ratings for ${course.courseName}, from 1 to 5 stars`}
                      />
                    )}

                    <div className="space-y-0.5">
                      <MetricRow
                        label="Ratings submitted"
                        value={
                          <span className="font-mono tabular-nums">{course.ratingsCount}</span>
                        }
                      />
                      <MetricRow
                        label="Your rating"
                        value={
                          <span className="font-mono tabular-nums">
                            {formatOwnRating(course.studentRating)}
                          </span>
                        }
                        hint={
                          course.studentRating === null
                            ? "You have not rated this course yet."
                            : undefined
                        }
                      />
                    </div>

                    <div className="grid gap-3 rounded-lg border border-border p-3">
                      <div className="space-y-1">
                        <Label htmlFor={`rating-${course.offeringId}`}>Rate this course</Label>
                        <Select
                          value={ratingValue === null ? null : String(ratingValue)}
                          onValueChange={(value) => {
                            const next = Number(value)
                            if (Number.isInteger(next) && next >= 1 && next <= 5) {
                              setRatingDrafts((prev) => ({
                                ...prev,
                                [course.offeringId]: next,
                              }))
                            }
                          }}
                          items={RATING_OPTIONS}
                        >
                          <SelectTrigger
                            id={`rating-${course.offeringId}`}
                            className="w-full sm:w-44"
                          >
                            <SelectValue placeholder="Select a rating" />
                          </SelectTrigger>
                          <SelectContent>
                            {RATING_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor={`comment-${course.offeringId}`}>
                          Comment{" "}
                          <span className="font-normal text-muted-foreground">(optional)</span>
                        </Label>
                        <textarea
                          id={`comment-${course.offeringId}`}
                          value={commentValue}
                          onChange={(event) =>
                            setCommentDrafts((prev) => ({
                              ...prev,
                              [course.offeringId]: event.target.value,
                            }))
                          }
                          placeholder="Anything you want the course team to know"
                          className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          maxLength={500}
                        />
                      </div>

                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void submitRating(course)}
                          disabled={isSaving}
                        >
                          <Star className="size-4" aria-hidden="true" />
                          <span className="ml-1">Save rating</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Explore offered courses"
        description="Registration windows are set by the teacher; when a course is full you can join the waitlist."
      >
        <div className="grid gap-4">
          <FilterBar
            searchLabel="Search offered courses"
            searchPlaceholder="Search by course, code, class, or teacher"
            searchValue={search}
            onSearchChange={setSearch}
            selects={[
              {
                id: "student-courses-registration",
                label: "Registration",
                value: statusFilter,
                options: STATUS_FILTER_OPTIONS,
                onValueChange: (value) =>
                  setStatusFilter((value as CourseRegistrationStatus | "all") || "all"),
              },
            ]}
            resultCount={filteredOffered.length}
            resultNoun="course"
          />

          <DataTable
            caption="Offered courses"
            columns={CATALOG_COLUMNS}
            rows={filteredOffered}
            getRowId={(course) => course.offeringId}
            empty={
              <EmptyState
                size="sm"
                icon={Search}
                title="No courses match"
                description="Try a different search term or registration status."
              />
            }
            rowActions={(course) => {
              // The registration pill already names the state; only an offering
              // you can act on needs a control.
              if (course.isEnrolled || course.isWaitlisted) return null
              const canJoinWaitlist = course.registrationStatus === "full"
              return (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void enroll(course.offeringId)}
                  disabled={
                    (!course.canRegister && !canJoinWaitlist) || pendingId === course.offeringId
                  }
                >
                  {canJoinWaitlist ? "Join waitlist" : "Register"}
                </Button>
              )
            }}
          />
        </div>
      </SectionCard>
    </div>
  )
}
