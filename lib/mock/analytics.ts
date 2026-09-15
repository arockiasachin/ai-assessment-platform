import { MOCK_COHORT_AVERAGE, MOCK_MARKS, MOCK_STUDENTS } from "./course"
import type { CourseRating, DistributionBucket, TopicMastery, TrendPoint } from "./types"

/**
 * Analytics series for the cohort dashboards.
 *
 * The distribution is DERIVED from the published marks (Quiz 1), so the bars add
 * up to exactly the number of students with a published grade and (partly)
 * explain the cohort average. The trend series carries an explicit `null` gap,
 * and two topics report `null` mastery because too few responses exist — the
 * "insufficient data" state must be visible, not silently zero.
 */

const QUIZ_1_MAX = 20

const GRADE_BUCKETS: { bucket: string; min: number }[] = [
  { bucket: "90–100%", min: 90 },
  { bucket: "80–89%", min: 80 },
  { bucket: "70–79%", min: 70 },
  { bucket: "60–69%", min: 60 },
  { bucket: "Below 60%", min: 0 },
]

const publishedQuizPercents: number[] = MOCK_STUDENTS.map((student) => MOCK_MARKS.quiz1[student.id])
  .filter((points): points is number => points !== null)
  .map((points) => (points / QUIZ_1_MAX) * 100)

export const MOCK_GRADE_DISTRIBUTION: DistributionBucket[] = GRADE_BUCKETS.map((entry, index) => {
  const upper = index === 0 ? 101 : GRADE_BUCKETS[index - 1].min
  const count = publishedQuizPercents.filter(
    (percent) => percent >= entry.min && percent < upper,
  ).length
  return { bucket: entry.bucket, count }
})

/**
 * Cohort mean by teaching week. `value` is the cohort mean, `average` is the
 * term target the trend chart draws as a dashed line. Week 3 is `null`: a
 * teaching week with no assessed work, so there is nothing to plot.
 */
export const MOCK_SCORE_TREND: TrendPoint[] = [
  { period: "W1", value: 68, average: 70 },
  { period: "W2", value: 71, average: 72 },
  { period: "W3", value: null, average: 73 },
  { period: "W4", value: 74, average: 74 },
  { period: "W5", value: 76, average: 75 },
  { period: "W6", value: MOCK_COHORT_AVERAGE, average: 76 },
]

export const MOCK_TOPIC_MASTERY: TopicMastery[] = [
  { topic: "Solving linear equations", mastery: 81, responses: 24 },
  { topic: "Algebraic manipulation", mastery: 75, responses: 12 },
  { topic: "Gradient & intercept", mastery: 83, responses: 12 },
  { topic: "Parallel & perpendicular", mastery: null, responses: 0 },
  { topic: "Inequalities", mastery: null, responses: 3 },
]

/** Ratings written by students, newest first. One comment was purged. */
export const MOCK_COURSE_RATINGS: CourseRating[] = [
  {
    id: "rating_01",
    studentName: "Chen Wei",
    rating: 5,
    comment:
      "The rubric feedback tells me exactly which sentence lost marks. Best part of the course.",
    createdAt: "2026-09-13T09:20:00.000Z",
    purged: false,
  },
  {
    id: "rating_02",
    studentName: "Diya Nair",
    rating: 4,
    comment:
      "Quiz feedback is quick, but the code task instructions could say empty input is allowed.",
    createdAt: "2026-09-12T18:40:00.000Z",
    purged: false,
  },
  {
    id: "rating_03",
    studentName: "Aarav Mehta",
    rating: 5,
    comment: "Being able to see the AI rationale and disagree with it is what makes this fair.",
    createdAt: "2026-09-12T10:05:00.000Z",
    purged: false,
  },
  {
    id: "rating_04",
    studentName: "Isaiah Thompson",
    rating: 3,
    comment: "I would like more worked examples before the first quiz.",
    createdAt: "2026-09-11T16:30:00.000Z",
    purged: false,
  },
  {
    id: "rating_05",
    studentName: "Gabriela Santos",
    rating: 4,
    // No written comment — the numeric rating still counts towards the average.
    comment: null,
    createdAt: "2026-09-10T12:15:00.000Z",
    purged: false,
  },
  {
    id: "rating_06",
    studentName: "Mateo Fernández",
    rating: 5,
    comment: "Group milestones kept our team honest about who was doing what.",
    createdAt: "2026-09-09T08:55:00.000Z",
    purged: false,
  },
  {
    id: "rating_07",
    studentName: "Priya Krishnan",
    rating: 4,
    comment: "Adaptive retake is genuinely useful for the topics I got wrong.",
    createdAt: "2026-09-08T14:10:00.000Z",
    purged: false,
  },
  {
    id: "rating_08",
    studentName: "Farah Al-Rashid",
    rating: 4,
    // Written feedback was redacted by the retention purge; the rating remains.
    comment: null,
    createdAt: "2026-09-07T11:25:00.000Z",
    purged: true,
  },
]

/** Average of the numeric ratings above. */
export const MOCK_COURSE_RATING_AVERAGE =
  Math.round(
    (MOCK_COURSE_RATINGS.reduce((total, rating) => total + rating.rating, 0) /
      MOCK_COURSE_RATINGS.length) *
      10,
  ) / 10

export const MOCK_AT_RISK_STUDENTS = MOCK_STUDENTS.filter((student) => student.atRisk)

export const MOCK_ANALYTICS_SUMMARY = {
  cohortAverage: MOCK_COHORT_AVERAGE,
  publishedCount: publishedQuizPercents.length,
  medianPercent: (() => {
    if (publishedQuizPercents.length === 0) return null
    const sorted = [...publishedQuizPercents].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return Math.round(
      sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    )
  })(),
  completionPercent: 62,
  atRiskCount: MOCK_AT_RISK_STUDENTS.length,
  ratingAverage: MOCK_COURSE_RATING_AVERAGE,
}
