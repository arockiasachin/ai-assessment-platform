import { MOCK_COHORT_AVERAGE, MOCK_STUDENTS } from "./course"
import { MOCK_ANALYTICS_SUMMARY } from "./analytics"
import { MOCK_PENDING_REVIEWS } from "./reviews"
import { MOCK_ADMIN_SUMMARY } from "./admin"
import type { CalendarEventView, Kpi } from "./types"

/**
 * Dashboard-level summaries and the calendar feed.
 *
 * Kept separate from the domain modules so a page can render a dashboard header
 * without importing the whole fixture graph, and so the KPIs have one obvious
 * place to change when a real endpoint replaces them.
 */

const demoStudent = MOCK_STUDENTS.find((student) => student.id === "stu_aarav")
const outstandingPeerEvaluations = 3

export const MOCK_TEACHER_KPIS: Kpi[] = [
  {
    id: "kpi_students",
    label: "Enrolled",
    value: String(MOCK_STUDENTS.length),
    hint: "Section A · 1 group unformed",
    tone: "active",
  },
  {
    id: "kpi_average",
    label: "Cohort average",
    value: MOCK_COHORT_AVERAGE === null ? "—" : `${MOCK_COHORT_AVERAGE}%`,
    hint: "Published Quiz 1 only",
    delta: { value: "+4 pts", direction: "up", sentiment: "positive" },
    tone: "completed",
  },
  {
    id: "kpi_review",
    label: "Awaiting review",
    value: String(MOCK_PENDING_REVIEWS.length),
    hint: "6 descriptive · 3 other",
    tone: "needs-review",
  },
  {
    id: "kpi_at_risk",
    label: "At risk",
    value: String(MOCK_ANALYTICS_SUMMARY.atRiskCount),
    hint: "Below 60% or no submissions",
    delta: { value: "+1", direction: "up", sentiment: "negative" },
    tone: "flagged",
  },
]

export const MOCK_STUDENT_KPIS: Kpi[] = [
  {
    id: "kpi_overall",
    label: "Overall",
    value: demoStudent?.avgPercent === null ? "—" : `${demoStudent?.avgPercent ?? "—"}%`,
    hint: "Across published work",
    delta: { value: "+3 pts", direction: "up", sentiment: "positive" },
    tone: "completed",
  },
  {
    id: "kpi_due",
    label: "Due this week",
    value: "2",
    hint: "Code task · Quiz 2",
    tone: "pending",
  },
  {
    id: "kpi_submitted",
    label: "Submitted",
    value: "4 of 6",
    hint: "2 never submitted",
    tone: "active",
  },
  {
    id: "kpi_peer",
    label: "Peer evaluations",
    value: `${outstandingPeerEvaluations} to do`,
    hint: "Team Matrices",
    tone: "needs-review",
  },
]

export const MOCK_ADMIN_KPIS: Kpi[] = [
  {
    id: "kpi_users",
    label: "Active accounts",
    value: String(MOCK_ADMIN_SUMMARY.activeUsers),
    hint: `${MOCK_ADMIN_SUMMARY.pendingUsers} pending activation`,
    tone: "active",
  },
  {
    id: "kpi_seats",
    label: "Seats filled",
    value: `${MOCK_ADMIN_SUMMARY.seatsUsed} / 120`,
    hint: `${MOCK_ADMIN_SUMMARY.activeOfferings} active offerings`,
    tone: "completed",
  },
  {
    id: "kpi_datasets",
    label: "Datasets",
    value: String(MOCK_ADMIN_SUMMARY.datasetsNeedingReview + 4),
    hint: `${MOCK_ADMIN_SUMMARY.datasetsNeedingReview} needs review`,
    tone: "needs-review",
  },
  {
    id: "kpi_mappings",
    label: "LTI mappings",
    value: "96 / 121",
    hint: "25 accounts unmapped",
    delta: { value: "−25", direction: "down", sentiment: "negative" },
    tone: "pending",
  },
]

/**
 * Compact sparkline series. Deliberately short (7–8 points) — they are for
 * shape, not for reading exact values, so the accessible description belongs in
 * the surrounding `StatCard` hint.
 */
export const MOCK_SPARKLINES = {
  cohort: [68, 71, 70, 74, 76, MOCK_COHORT_AVERAGE ?? 78],
  student: [72, 74, 73, 80, 84, 88],
  reviewBacklog: [3, 4, 4, 6, 7, 9],
  submissions: [2, 5, 6, 9, 11, 12],
  exports: [1, 2, 2, 3, 4, 5],
  users: [4, 5, 5, 6, 6, 6],
  atRisk: [1, 1, 1, 2, 2, MOCK_ANALYTICS_SUMMARY.atRiskCount],
} as const

export const MOCK_CALENDAR_EVENTS: CalendarEventView[] = [
  {
    id: "cal_01",
    title: "Lecture — Quadratic forms",
    kind: "CLASS",
    startAt: "2026-09-15T04:30:00.000Z",
    endAt: "2026-09-15T06:00:00.000Z",
    location: "TT-204",
    courseCode: "MTH-201",
    detail: "Completing the square and the discriminant.",
  },
  {
    id: "cal_02",
    title: "Code Task — Sorting & Big-O due",
    kind: "ASSESSMENT",
    startAt: "2026-09-20T13:30:00.000Z",
    endAt: null,
    location: null,
    courseCode: "MTH-201",
    detail: "Python sandbox · 6 test cases · 5s limit.",
  },
  {
    id: "cal_03",
    title: "Office hours",
    kind: "REMINDER",
    startAt: "2026-09-17T09:00:00.000Z",
    endAt: "2026-09-17T10:00:00.000Z",
    location: "Faculty block, room 318",
    courseCode: "MTH-201",
    detail: "Bring rubric questions about the descriptive task.",
  },
  {
    id: "cal_04",
    title: "Quiz 2 — Quadratics",
    kind: "ASSESSMENT",
    startAt: "2026-09-28T13:30:00.000Z",
    endAt: "2026-09-28T14:30:00.000Z",
    location: "Online",
    courseCode: "MTH-201",
    detail: "Draft — not yet published to students.",
  },
  {
    id: "cal_05",
    title: "Group project check-in",
    kind: "CLASS",
    startAt: "2026-09-22T05:00:00.000Z",
    endAt: "2026-09-22T06:00:00.000Z",
    location: "TT-204",
    courseCode: "MTH-201",
    detail: "Milestone 3 (story outline) review with each team.",
  },
  {
    id: "cal_06",
    title: "Institution holiday",
    kind: "HOLIDAY",
    startAt: "2026-10-02T00:00:00.000Z",
    endAt: "2026-10-02T23:59:00.000Z",
    location: null,
    courseCode: null,
    detail: "No classes scheduled.",
  },
  {
    id: "cal_07",
    title: "Group Project — Data Storytelling due",
    kind: "ASSESSMENT",
    startAt: "2026-10-10T13:30:00.000Z",
    endAt: null,
    location: null,
    courseCode: "MTH-201",
    detail: "Peer evaluation round 1 closes the same day.",
  },
]

/** Convenience: the next few events from the fixed mock clock. */
export const MOCK_UPCOMING_EVENTS = MOCK_CALENDAR_EVENTS.slice(0, 4)
