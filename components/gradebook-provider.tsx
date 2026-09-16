"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import {
  markKey,
  type Assessment,
  type Course,
  type MarksMap,
  type Offering,
  type UpcomingEvent,
  type Quiz,
  type Student,
} from "@/lib/gradebook"
import type { CreateAssessmentRequest } from "@/lib/contracts"

export type Role = "teacher" | "student"

type NewAssessment = {
  title: string
  /**
   * The specific offering to write into. Never a `courseId`: a teacher can own
   * several offerings for one course and only the offering identifies the class.
   */
  offeringId: string
  /** The API contract's vocabulary, not the Prisma enum: this is a create input. */
  type: CreateAssessmentRequest["type"]
  date: string
  maxMarks: number
}

export type GradebookPayload = {
  students: Student[]
  courses: Course[]
  assessments: Assessment[]
  marks: MarksMap
  quizzes: Quiz[]
  upcomingEvents: UpcomingEvent[]
  selectedStudentId: string | null
  classAverages?: Record<string, number | null>
  offerings?: Offering[]
}

type GradebookContextValue = {
  role: Role
  setRole: (r: Role) => void
  isLoading: boolean
  loadError: string | null
  refresh: () => Promise<void>
  selectedStudentId: string
  setSelectedStudentId: (id: string) => void
  courseFilter: string | "all"
  setCourseFilter: (s: string | "all") => void
  search: string
  setSearch: (s: string) => void
  students: Student[]
  courses: Course[]
  assessments: Assessment[]
  quizzes: Quiz[]
  upcomingEvents: UpcomingEvent[]
  marks: MarksMap
  /** Teacher-owned offerings available to the assessment authoring dialogs. */
  offerings: Offering[]
  /** Server-computed average percentage per assessment; empty for teachers. */
  classAverages: Record<string, number | null>
  setMark: (studentId: string, assessmentId: string, score: number | null) => void
  addAssessment: (a: NewAssessment) => void
}

const GradebookContext = createContext<GradebookContextValue | null>(null)

/**
 * @param initialPayload Server-fetched gradebook data. **When provided, the mount fetch is
 *   skipped**, so the first render is already populated instead of showing an empty shell that
 *   fills in a moment later. That is the P1 finding from `docs/quality/a11y-perf-audit.md`:
 *   the payload was always fetched client-side on mount, so every dashboard route rendered twice
 *   and flashed.
 * @param initialRole The signed-in user's role, **seeded rather than inferred**. `role` defaulted
 *   to `"teacher"`, and the dashboard header renders `role === "teacher" ? "Teacher view" : …`, so
 *   a student's page server-rendered the *teacher* label until hydration corrected it.
 */
export function GradebookProvider({
  children,
  initialPayload,
  initialRole,
}: {
  children: ReactNode
  initialPayload?: GradebookPayload | null
  initialRole?: Role
}) {
  const pathname = usePathname()
  const seeded = initialPayload ?? null

  const [role, setRole] = useState<Role>(initialRole ?? "teacher")
  // Seeded means not loading — the data is already here.
  const [isLoading, setIsLoading] = useState(seeded === null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    seeded?.selectedStudentId ?? seeded?.students[0]?.id ?? "",
  )
  const [courseFilter, setCourseFilter] = useState<string | "all">("all")
  const [search, setSearch] = useState("")
  const [students, setStudents] = useState<Student[]>(seeded?.students ?? [])
  const [courses, setCourses] = useState<Course[]>(seeded?.courses ?? [])
  const [assessments, setAssessments] = useState<Assessment[]>(seeded?.assessments ?? [])
  const [quizzes, setQuizzes] = useState<Quiz[]>(seeded?.quizzes ?? [])
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>(
    seeded?.upcomingEvents ?? [],
  )
  const [marks, setMarks] = useState<MarksMap>(seeded?.marks ?? {})
  const [classAverages, setClassAverages] = useState<Record<string, number | null>>(
    seeded?.classAverages ?? {},
  )
  const [offerings, setOfferings] = useState<Offering[]>(seeded?.offerings ?? [])

  const applyPayload = (payload: GradebookPayload) => {
    setStudents(payload.students)
    setCourses(payload.courses)
    setAssessments(payload.assessments)
    setQuizzes(payload.quizzes)
    setUpcomingEvents(payload.upcomingEvents)
    setMarks(payload.marks)
    setClassAverages(payload.classAverages ?? {})
    setOfferings(payload.offerings ?? [])
    setSelectedStudentId(payload.selectedStudentId ?? payload.students[0]?.id ?? "")
    setCourseFilter((current) => {
      if (current === "all") return "all"
      const exists = payload.courses.some((c) => c.id === current)
      return exists ? current : "all"
    })
  }

  const loadGradebook = async () => {
    try {
      const response = await fetch("/api/gradebook", { cache: "no-store" })
      if (!response.ok) {
        setLoadError("Unable to load gradebook data.")
        return
      }
      const data = (await response.json()) as GradebookPayload
      applyPayload(data)
    } catch {
      setLoadError("Unable to load gradebook data.")
    } finally {
      setIsLoading(false)
    }
  }

  const refresh = async () => {
    setLoadError(null)
    setIsLoading(true)
    await loadGradebook()
  }

  // The provider is mounted in the root layout, so this effect runs on every
  // route. The gradebook API is role-scoped and returns 401 for anonymous
  // visitors, so fetching on the unauthenticated /mockup tree only produces
  // console noise. Skip it there; real dashboard routes are unaffected.
  //
  // The P1 "fetch on mount" finding is now fixed for the dashboard subtree, which mounts a
  // seeded provider from `app/(dashboard)/layout.tsx`. This guard still matters for the rest of
  // the tree — notably `/mockup` and `/quiz`, which keep the fetch-on-mount behaviour because
  // they sit outside `(dashboard)` and get the root provider.
  const isMockupRoute = pathname.startsWith("/mockup")

  useEffect(() => {
    if (isMockupRoute) {
      setIsLoading(false)
      return
    }
    // **Seeded means do not fetch.** Running the fetch anyway would re-apply the payload over
    // state the user may already have touched — `applyPayload` resets `selectedStudentId` and
    // re-clamps `courseFilter` — so "seed and also fetch" is strictly worse than either alone.
    // `refresh()` stays available for the write paths that need fresh rows.
    if (seeded !== null) return
    void loadGradebook()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadGradebook is stable per render and intentionally not a dependency
  }, [isMockupRoute, seeded])

  const setMark = (studentId: string, assessmentId: string, score: number | null) => {
    setMarks((prev) => {
      const next = { ...prev }
      const key = markKey(studentId, assessmentId)
      if (score === null || Number.isNaN(score)) {
        delete next[key]
      } else {
        next[key] = score
      }
      return next
    })

    void fetch("/api/gradebook/marks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, assessmentId, score }),
    })
  }

  const addAssessment = (a: NewAssessment) => {
    void fetch("/api/gradebook/assessments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    })
      .then(async (res) => {
        if (!res.ok) return
        const created = (await res.json()) as { assessment: Assessment }
        setAssessments((prev) => [...prev, created.assessment])
      })
      .catch(() => {
        // Keep client usable; next refresh will reconcile state.
      })
  }

  const value = useMemo<GradebookContextValue>(
    () => ({
      role,
      setRole,
      isLoading,
      loadError,
      refresh,
      selectedStudentId,
      setSelectedStudentId,
      courseFilter,
      setCourseFilter,
      search,
      setSearch,
      students,
      courses,
      assessments,
      quizzes,
      upcomingEvents,
      marks,
      offerings,
      classAverages,
      setMark,
      addAssessment,
    }),
    [
      role,
      isLoading,
      loadError,
      selectedStudentId,
      courseFilter,
      search,
      students,
      courses,
      assessments,
      quizzes,
      upcomingEvents,
      marks,
      offerings,
      classAverages,
    ],
  )

  return <GradebookContext.Provider value={value}>{children}</GradebookContext.Provider>
}

export function useGradebook() {
  const ctx = useContext(GradebookContext)
  if (!ctx) throw new Error("useGradebook must be used within GradebookProvider")
  return ctx
}
