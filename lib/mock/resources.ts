import type { MaterialView, RetakeRecommendation } from "./types"

/**
 * Course materials and adaptive-retake recommendations.
 *
 * Edge cases on purpose: a material that has not been indexed yet (so quiz AI
 * cannot retrieve from it), a link with no stored file (`sourceUrl: null` uses
 * an external URL instead), and a retake topic with `mastery: null` because the
 * student has too few attempts.
 */

export const MOCK_MATERIALS: MaterialView[] = [
  {
    id: "mat_01",
    title: "Week 1 — Linear structures (slides)",
    kind: "SLIDE_DECK",
    topic: "Solving linear equations",
    sourceUrl: "https://cdn.example.edu/mth201/w1-linear.pdf",
    mimeType: "application/pdf",
    sizeLabel: "2.4 MB",
    updatedAt: "2026-08-24T06:00:00.000Z",
    courseCode: "MTH-201",
    indexed: true,
    chunks: 48,
    state: "completed",
  },
  {
    id: "mat_02",
    title: "Modelling with functions — worked examples",
    kind: "DOCUMENT",
    topic: "Modelling accuracy",
    sourceUrl: "https://cdn.example.edu/mth201/modelling-examples.pdf",
    mimeType: "application/pdf",
    sizeLabel: "1.1 MB",
    updatedAt: "2026-09-02T05:30:00.000Z",
    courseCode: "MTH-201",
    indexed: true,
    chunks: 31,
    state: "completed",
  },
  {
    id: "mat_03",
    title: "Lecture recording — gradients and intercepts",
    kind: "VIDEO",
    topic: "Gradient & intercept",
    sourceUrl: "https://cdn.example.edu/mth201/w2-lecture.mp4",
    mimeType: "video/mp4",
    sizeLabel: "312 MB",
    updatedAt: "2026-09-01T11:20:00.000Z",
    courseCode: "MTH-201",
    indexed: true,
    chunks: 12,
    state: "completed",
  },
  {
    id: "mat_04",
    title: "Transcript — gradients and intercepts",
    kind: "TRANSCRIPT",
    topic: "Gradient & intercept",
    sourceUrl: null,
    mimeType: null,
    sizeLabel: null,
    updatedAt: "2026-09-01T14:00:00.000Z",
    courseCode: "MTH-201",
    indexed: true,
    chunks: 22,
    state: "completed",
  },
  {
    id: "mat_05",
    title: "Inequalities refresher (external)",
    kind: "LINK",
    topic: "Inequalities",
    sourceUrl:
      "https://openstax.org/books/algebra-intermediate/pages/2-5-solve-linear-inequalities",
    mimeType: null,
    sizeLabel: null,
    updatedAt: "2026-09-08T09:10:00.000Z",
    courseCode: "MTH-201",
    indexed: false,
    chunks: 0,
    state: "pending",
  },
  {
    id: "mat_06",
    title: "Big-O cheat sheet",
    kind: "DOCUMENT",
    topic: "Complexity",
    sourceUrl: "https://cdn.example.edu/mth201/big-o-cheatsheet.pdf",
    mimeType: "application/pdf",
    sizeLabel: "640 KB",
    updatedAt: "2026-09-13T07:45:00.000Z",
    courseCode: "MTH-201",
    indexed: false,
    chunks: 0,
    state: "queued",
  },
]

/**
 * The adaptive retake list for the demo student, built from their weakest
 * subtopics. `mastery: null` means "not enough attempts to tell", which the UI
 * must show as insufficient data rather than as 0%.
 */
export const MOCK_RETAKE_RECOMMENDATIONS: RetakeRecommendation[] = [
  {
    id: "retake_01",
    topic: "Solving linear equations",
    mastery: 62,
    questions: 6,
    reason: "Two sign errors on Quiz 1, question 4.",
    state: "active",
  },
  {
    id: "retake_02",
    topic: "Algebraic manipulation",
    mastery: 58,
    questions: 5,
    reason: "Distribution errors repeated across the last two attempts.",
    state: "active",
  },
  {
    id: "retake_03",
    topic: "Inequalities",
    mastery: null,
    questions: 4,
    reason: "Only one attempt so far — retake to establish a baseline.",
    state: "insufficient-data",
  },
  {
    id: "retake_04",
    topic: "Gradient & intercept",
    mastery: 83,
    questions: 3,
    reason: "Strong already; included for spaced revision only.",
    state: "completed",
  },
]

export const MOCK_MATERIALS_SUMMARY = {
  total: MOCK_MATERIALS.length,
  indexed: MOCK_MATERIALS.filter((material) => material.indexed).length,
  pending: MOCK_MATERIALS.filter((material) => !material.indexed).length,
  chunks: MOCK_MATERIALS.reduce((total, material) => total + material.chunks, 0),
}
