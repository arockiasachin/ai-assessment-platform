"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  markKey,
  type Assessment,
  type AssessmentType,
  type Course,
  type MarksMap,
  type Offering,
  type UpcomingEvent,
  type Quiz,
  type Student,
} from "@/lib/gradebook"

export type Role = "teacher" | "student"

type NewAssessment = {
  title: string
  /**
   * The specific offering to write into. Never a `courseId`: a teacher can own
   * several offerings for one course and only the offering identifies the class.
   */
  offeringId: string
  type: AssessmentType
  date: string
  maxMarks: number
}

type GradebookPayload = {
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

export function GradebookProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("teacher")
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedStudentId, setSelectedStudentId] = useState<string>("")
  const [courseFilter, setCourseFilter] = useState<string | "all">("all")
  const [search, setSearch] = useState("")
  const [students, setStudents] = useState<Student[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([])
  const [marks, setMarks] = useState<MarksMap>({})
  const [classAverages, setClassAverages] = useState<Record<string, number | null>>({})
  const [offerings, setOfferings] = useState<Offering[]>([])

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

  useEffect(() => {
    void loadGradebook()
  }, [])

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
