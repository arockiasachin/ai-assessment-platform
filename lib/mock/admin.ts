import type { AdminDataset, AdminOffering, AdminTool, AdminUser, FeatureFlag } from "./types"

/**
 * Institution-level entities for the admin mockups.
 *
 * Edge cases on purpose: accounts that have never signed in (`lastLoginAt: null`),
 * an offering running under capacity, and a dataset whose results are not
 * published so the retention clock has not started (`retentionUntil: null`).
 */

export const MOCK_ADMIN_USERS: AdminUser[] = [
  {
    id: "usr_admin_01",
    name: "Ada Okonkwo",
    email: "ada.okonkwo@vit.ac.in",
    role: "ADMIN",
    state: "active",
    offerings: 0,
    lastLoginAt: "2026-09-15T05:40:00.000Z",
  },
  {
    id: "usr_teacher_01",
    name: "Dr. Meera Raman",
    email: "meera.raman@vit.ac.in",
    role: "TEACHER",
    state: "active",
    offerings: 3,
    lastLoginAt: "2026-09-15T06:10:00.000Z",
  },
  {
    id: "usr_teacher_02",
    name: "Prof. Daniel Okafor",
    email: "daniel.okafor@vit.ac.in",
    role: "TEACHER",
    state: "active",
    offerings: 2,
    lastLoginAt: "2026-09-14T22:05:00.000Z",
  },
  {
    id: "usr_teacher_03",
    name: "Dr. Sophia Lindqvist",
    email: "sophia.lindqvist@vit.ac.in",
    role: "TEACHER",
    state: "active",
    offerings: 1,
    lastLoginAt: "2026-09-12T08:30:00.000Z",
  },
  {
    id: "usr_student_01",
    name: "Aarav Mehta",
    email: "aarav.mehta@vitstudent.ac.in",
    role: "STUDENT",
    state: "active",
    offerings: 4,
    lastLoginAt: "2026-09-15T12:10:00.000Z",
  },
  {
    id: "usr_student_14",
    name: "Ravi Anand",
    email: "ravi.anand@vitstudent.ac.in",
    role: "STUDENT",
    state: "active",
    offerings: 4,
    // Provisioned by the registrar import; the student has never signed in.
    lastLoginAt: null,
  },
  {
    id: "usr_teacher_04",
    name: "Prof. Hannah Meyer",
    email: "hannah.meyer@vit.ac.in",
    role: "TEACHER",
    state: "pending",
    offerings: 0,
    lastLoginAt: null,
  },
  {
    id: "usr_teacher_05",
    name: "Dr. Victor Nwosu",
    email: "victor.nwosu@vit.ac.in",
    role: "TEACHER",
    state: "archived",
    offerings: 0,
    lastLoginAt: "2026-06-30T15:20:00.000Z",
  },
]

export const MOCK_ADMIN_OFFERINGS: AdminOffering[] = [
  {
    id: "off_algebra_a_2026",
    courseCode: "MTH-201",
    courseName: "Algebra Foundations",
    section: "Section A",
    teacherName: "Dr. Meera Raman",
    term: "Fall 2026",
    enrolled: 13,
    capacity: 40,
    state: "active",
  },
  {
    id: "off_algebra_b_2026",
    courseCode: "MTH-201",
    courseName: "Algebra Foundations",
    section: "Section B",
    teacherName: "Prof. Daniel Okafor",
    term: "Fall 2026",
    enrolled: 31,
    capacity: 35,
    state: "active",
  },
  {
    id: "off_stats_a_2026",
    courseCode: "STA-210",
    courseName: "Applied Statistics",
    section: "Section A",
    teacherName: "Dr. Sophia Lindqvist",
    term: "Fall 2026",
    enrolled: 28,
    capacity: 30,
    state: "active",
  },
  {
    id: "off_ml_b_2026",
    courseCode: "CSE-340",
    courseName: "Machine Learning Foundations",
    section: "Section B",
    teacherName: "Prof. Daniel Okafor",
    term: "Fall 2026",
    enrolled: 44,
    capacity: 45,
    state: "active",
  },
  {
    id: "off_algebra_a_2025",
    courseCode: "MTH-201",
    courseName: "Algebra Foundations",
    section: "Section A",
    teacherName: "Dr. Meera Raman",
    term: "Fall 2025",
    enrolled: 37,
    capacity: 40,
    // Results published, so the retention purge window has closed.
    state: "archived",
  },
  {
    id: "off_stats_b_2026",
    courseCode: "STA-210",
    courseName: "Applied Statistics",
    section: "Section B",
    teacherName: "Prof. Hannah Meyer",
    term: "Spring 2027",
    enrolled: 0,
    capacity: 30,
    state: "draft",
  },
]

export const MOCK_ADMIN_DATASETS: AdminDataset[] = [
  {
    id: "ds_roster",
    name: "Registrar roster import",
    source: "registrar-feed.csv",
    rowCount: 1_284,
    updatedAt: "2026-09-15T04:15:00.000Z",
    owner: "Ada Okonkwo",
    state: "active",
    retentionUntil: null,
  },
  {
    id: "ds_quiz_bank",
    name: "Generated question bank",
    source: "quiz-generation",
    rowCount: 412,
    updatedAt: "2026-09-15T06:22:00.000Z",
    owner: "Dr. Meera Raman",
    state: "active",
    retentionUntil: null,
  },
  {
    id: "ds_grades_2025",
    name: "Fall 2025 published grades",
    source: "grade-store",
    rowCount: 3_906,
    updatedAt: "2025-12-20T09:00:00.000Z",
    owner: "Ada Okonkwo",
    state: "archived",
    retentionUntil: "2026-09-18T00:00:00.000Z",
  },
  {
    id: "ds_material_index",
    name: "Course material embeddings",
    source: "vector-index",
    rowCount: 18_742,
    updatedAt: "2026-09-14T23:40:00.000Z",
    owner: "integration-worker",
    state: "active",
    retentionUntil: null,
  },
  {
    id: "ds_lti_mappings",
    name: "LTI user mappings",
    source: "canvas-api",
    rowCount: 96,
    updatedAt: "2026-09-13T21:12:00.000Z",
    owner: "integration-worker",
    state: "needs-review",
    retentionUntil: null,
  },
]

export const MOCK_ADMIN_SUMMARY = {
  activeUsers: MOCK_ADMIN_USERS.filter((user) => user.state === "active").length,
  pendingUsers: MOCK_ADMIN_USERS.filter((user) => user.state === "pending").length,
  activeOfferings: MOCK_ADMIN_OFFERINGS.filter((offering) => offering.state === "active").length,
  seatsUsed: MOCK_ADMIN_OFFERINGS.filter((offering) => offering.state === "active").reduce(
    (total, offering) => total + offering.enrolled,
    0,
  ),
  datasetsNeedingReview: MOCK_ADMIN_DATASETS.filter((dataset) => dataset.state === "needs-review")
    .length,
}

/** Maintenance and diagnostic actions. One has never been run. */
export const MOCK_ADMIN_TOOLS: AdminTool[] = [
  {
    id: "tool_retention_purge",
    name: "Run retention purge",
    description:
      "Redacts student content for offerings whose 15-day window after results publication has closed.",
    category: "Retention",
    state: "completed",
    lastRunAt: "2026-09-07T02:00:00.000Z",
    lastRunBy: "retention-worker",
  },
  {
    id: "tool_lti_rotate",
    name: "Rotate LTI signing key reference",
    description:
      "Points the Moodle registration at a new key reference. The key itself is never stored here.",
    category: "Integrations",
    state: "needs-review",
    lastRunAt: "2026-09-12T20:00:00.000Z",
    lastRunBy: "Ada Okonkwo",
  },
  {
    id: "tool_reindex",
    name: "Re-index course material",
    description: "Rebuilds retrieval chunks for every material in an offering.",
    category: "Diagnostics",
    state: "running",
    lastRunAt: "2026-09-15T06:50:00.000Z",
    lastRunBy: "integration-worker",
  },
  {
    id: "tool_rebalance",
    name: "Rebalance offerings",
    description: "Moves over-capacity enrolments to a parallel section with spare seats.",
    category: "Access",
    state: "queued",
    lastRunAt: null,
    lastRunBy: null,
  },
  {
    id: "tool_health",
    name: "Integration health check",
    description: "Pings every configured LMS registration and reports scope problems.",
    category: "Integrations",
    state: "completed",
    lastRunAt: "2026-09-15T05:00:00.000Z",
    lastRunBy: "integration-worker",
  },
]

export const MOCK_FEATURE_FLAGS: FeatureFlag[] = [
  {
    id: "flag_auto_accept",
    key: "grading.auto-accept-high-confidence",
    description: "Auto-accept rubric suggestions at confidence ≥ 0.78 and queue a spot check.",
    enabled: true,
    rolloutPercent: 100,
    owner: "Dr. Meera Raman",
  },
  {
    id: "flag_peer_eval",
    key: "groups.catme-peer-evaluation",
    description: "CATME five-dimension peer evaluation with adjustment factors.",
    enabled: true,
    rolloutPercent: 100,
    owner: "Ada Okonkwo",
  },
  {
    id: "flag_adaptive_retake",
    key: "student.adaptive-retake",
    description: "Build retake practice sets from a student's weakest subtopics.",
    enabled: true,
    rolloutPercent: 40,
    owner: "Prof. Daniel Okafor",
  },
  {
    id: "flag_similarity",
    key: "code.similarity-check",
    description: "Cross-submission similarity detection with a teacher verdict.",
    enabled: false,
    rolloutPercent: 0,
    owner: "Ada Okonkwo",
  },
]
