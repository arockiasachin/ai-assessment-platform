import type { AuditEvent, ExportRow } from "./types"

/**
 * LMS integration health and the append-only audit trail.
 *
 * Edge cases on purpose: a passback that has never synced (`lastSyncedAt: null`),
 * partial user mappings (so some grades cannot leave the platform), and a
 * FAILED row with real `issues` text.
 */

export const MOCK_EXPORT_ROWS: ExportRow[] = [
  {
    id: "exp_oneroster_roster",
    target: "Roster — OneRoster 1.2",
    platform: "OneRoster",
    course: "MTH-201 · Section A",
    state: "completed",
    lastSyncedAt: "2026-09-15T05:00:00.000Z",
    mappedUsers: 13,
    totalUsers: 13,
    issues: [],
    lineItemsUrl: null,
  },
  {
    id: "exp_oneroster_grades",
    target: "Grades — OneRoster 1.2",
    platform: "OneRoster",
    course: "MTH-201 · Section A",
    state: "published",
    lastSyncedAt: "2026-09-15T05:02:00.000Z",
    mappedUsers: 13,
    totalUsers: 13,
    issues: [],
    lineItemsUrl: "https://lms.example.edu/one-roster/lineitems/mth201-a",
  },
  {
    id: "exp_lti_ags",
    target: "Grade passback — LTI 1.3 AGS",
    platform: "Canvas",
    course: "MTH-201 · Section A",
    state: "pending",
    lastSyncedAt: "2026-09-14T19:30:00.000Z",
    mappedUsers: 10,
    totalUsers: 13,
    issues: [
      "3 students have no LMS user id, so their grades will not sync.",
      "Quiz 1 passback queued; Descriptive is withheld until it is published.",
    ],
    lineItemsUrl: "https://canvas.example.edu/api/lti/courses/8841/line_items",
  },
  {
    id: "exp_lti_mappings",
    target: "User mappings — LTI 1.3",
    platform: "Canvas",
    course: "All offerings",
    state: "needs-review",
    lastSyncedAt: null,
    mappedUsers: 96,
    totalUsers: 121,
    issues: ["25 unmapped accounts across 4 offerings."],
    lineItemsUrl: null,
  },
  {
    id: "exp_lti_moodle",
    target: "Grade passback — LTI 1.3 AGS",
    platform: "Moodle",
    course: "MTH-201 · Section B",
    state: "failed",
    lastSyncedAt: "2026-09-13T21:10:00.000Z",
    mappedUsers: 0,
    totalUsers: 31,
    issues: [
      "Registration key rotated on 2026-09-12; the signing key reference is stale.",
      "31 grades were not sent.",
    ],
    lineItemsUrl: null,
  },
]

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: "aud_01",
    action: "grade.override",
    entityType: "Grade",
    entityId: "grade_descriptive_stu_chen",
    actorName: "Dr. Meera Raman",
    actorRole: "TEACHER",
    summary:
      "Lowered the AI suggestion from 27.5 to 27.0 (notation error in the final paragraph). Reason stored for calibration.",
    createdAt: "2026-09-15T06:40:00.000Z",
    tone: "overridden",
  },
  {
    id: "aud_02",
    action: "grade_review.auto_accept",
    entityType: "GradeReview",
    entityId: "rev_desc_stu_aarav",
    actorName: "auto-threshold",
    actorRole: "SYSTEM",
    summary: "Auto-accepted 4 criteria at confidence ≥ 0.78; queued for a spot check.",
    createdAt: "2026-09-15T06:05:00.000Z",
    tone: "graded",
  },
  {
    id: "aud_03",
    action: "similarity.flag",
    entityType: "SimilarityCheck",
    entityId: "sim_01",
    actorName: "code-eval",
    actorRole: "SYSTEM",
    summary: "Flagged 0.91 similarity between Ethan Brooks and Chen Wei on Sorting & Big-O.",
    createdAt: "2026-09-14T16:45:00.000Z",
    tone: "flagged",
  },
  {
    id: "aud_04",
    action: "quiz.publish",
    entityType: "Assessment",
    entityId: "asm_quiz1",
    actorName: "Dr. Meera Raman",
    actorRole: "TEACHER",
    summary: "Published Quiz 1 grades for 12 students.",
    createdAt: "2026-09-03T06:35:00.000Z",
    tone: "published",
  },
  {
    id: "aud_05",
    action: "similarity.verdict",
    entityType: "SimilarityCheck",
    entityId: "sim_02",
    actorName: "Dr. Meera Raman",
    actorRole: "TEACHER",
    summary: "Cleared a 0.22 similarity pair after reviewing both submissions.",
    createdAt: "2026-09-13T10:20:00.000Z",
    tone: "completed",
  },
  {
    id: "aud_06",
    action: "lms.passback.failed",
    entityType: "ExportRun",
    entityId: "exp_lti_moodle",
    actorName: "integration-worker",
    actorRole: "SYSTEM",
    summary: "Moodle passback failed: stale signing key reference.",
    createdAt: "2026-09-13T21:10:00.000Z",
    tone: "failed",
  },
  {
    id: "aud_07",
    action: "grade_review.reject",
    entityType: "GradeReview",
    entityId: "rev_asm_assignment_stu_diya",
    actorName: "Dr. Meera Raman",
    actorRole: "TEACHER",
    summary: "Rejected the suggestion: no submission was received.",
    createdAt: "2026-09-12T07:55:00.000Z",
    tone: "rejected",
  },
  {
    id: "aud_08",
    action: "retention.purge",
    entityType: "CourseRating",
    entityId: "rating_08",
    actorName: "retention-worker",
    actorRole: "SYSTEM",
    summary: "Redacted one free-text rating comment; the numeric rating was retained.",
    createdAt: "2026-09-07T02:00:00.000Z",
    tone: "archived",
  },
]

/** Counts for the export page header. */
export const MOCK_EXPORT_SUMMARY = {
  healthy: MOCK_EXPORT_ROWS.filter((row) => row.state === "published" || row.state === "completed")
    .length,
  needsAttention: MOCK_EXPORT_ROWS.filter(
    (row) => row.state === "pending" || row.state === "needs-review",
  ).length,
  failing: MOCK_EXPORT_ROWS.filter((row) => row.state === "failed").length,
  unmappedUsers: MOCK_EXPORT_ROWS.reduce(
    (total, row) => total + (row.totalUsers - row.mappedUsers),
    0,
  ),
}
