import { formatCsvNumber, toCsv } from "./csv"

/**
 * OneRoster 1.2-shaped gradebook CSV.
 *
 * Pure: these builders take plain rows and return CSV text. The service maps
 * published grades and weighted final grades into the row shapes; nothing here
 * touches the database or the network, which is what makes the column semantics
 * unit-testable.
 *
 * The three files are the ones the OneRoster gradebook service defines:
 * `lineItems.csv`, `results.csv`, and `scoreScales.csv`. The exact columns are
 * documented in `docs/features/lms-export.md` and asserted by
 * `tests/lms-export-oneroster.test.ts`.
 */

export const ONE_ROSTER_STATUS_ACTIVE = "active"
export const ONE_ROSTER_SCORE_STATUS_GRADED = "fully graded"
export const ONE_ROSTER_FINAL_CATEGORY = "Final Grade"
export const ONE_ROSTER_NUMERIC_SCALE = "numeric"

/** Stable, deterministic sourcedIds so re-exports are diffable. */
export function lineItemSourcedId(assessmentId: string): string {
  return `lineitem-${assessmentId}`
}

export function finalLineItemSourcedId(offeringId: string): string {
  return `lineitem-final-${offeringId}`
}

export function scoreScaleSourcedId(assessmentId: string): string {
  return `scales-${assessmentId}`
}

export function finalScoreScaleSourcedId(offeringId: string): string {
  return `scales-final-${offeringId}`
}

export function resultSourcedId(assessmentId: string, studentId: string): string {
  return `result-${assessmentId}-${studentId}`
}

export function finalResultSourcedId(studentId: string): string {
  return `result-final-${studentId}`
}

export type OneRosterOffering = {
  id: string
  courseId: string
  courseCode: string
  courseName: string
  className: string
}

export type OneRosterAssessment = {
  id: string
  title: string
  description?: string
  dueDate: string
  maxMarks: number
  category: string
}

export type OneRosterStudent = {
  id: string
  fullName: string
  registerNumber: string
}

export type OneRosterResultInput = {
  assessmentId: string
  studentId: string
  points: number
  maxPoints: number
  dateLastModified: string
  comment?: string
}

export type OneRosterFinalGradeInput = {
  studentId: string
  percentage: number
  dateLastModified: string
}

export type OneRosterInput = {
  offering: OneRosterOffering
  assessments: readonly OneRosterAssessment[]
  students: readonly OneRosterStudent[]
  results: readonly OneRosterResultInput[]
  finalGrades: readonly OneRosterFinalGradeInput[]
  /** Fallback `dateLastModified` for rows with no more specific timestamp. */
  lastModified: string
}

export type OneRosterLineItemRow = {
  sourcedId: string
  status: string
  dateLastModified: string
  title: string
  description: string
  assignDate: string
  dueDate: string
  classSourcedId: string
  courseSourcedId: string
  category: string
  resultValueMin: number
  resultValueMax: number
  scoreScaleSourcedId: string
}

export type OneRosterResultRow = {
  sourcedId: string
  status: string
  dateLastModified: string
  lineItemSourcedId: string
  studentSourcedId: string
  score: number
  scoreStatus: string
  resultValue: string
  comment: string
}

export type OneRosterScoreScaleRow = {
  sourcedId: string
  status: string
  dateLastModified: string
  title: string
  type: string
  minimum: number
  maximum: number
}

export type OneRosterGradebook = {
  lineItems: OneRosterLineItemRow[]
  results: OneRosterResultRow[]
  scoreScales: OneRosterScoreScaleRow[]
}

export const ONE_ROSTER_HEADERS: Record<keyof OneRosterGradebook, readonly string[]> = {
  lineItems: [
    "sourcedId",
    "status",
    "dateLastModified",
    "title",
    "description",
    "assignDate",
    "dueDate",
    "class",
    "course",
    "category",
    "resultValueMin",
    "resultValueMax",
    "scoreScale",
  ],
  results: [
    "sourcedId",
    "status",
    "dateLastModified",
    "lineItem",
    "student",
    "score",
    "scoreStatus",
    "resultValue",
    "comment",
  ],
  scoreScales: ["sourcedId", "status", "dateLastModified", "title", "type", "minimum", "maximum"],
}

/**
 * Build every OneRoster gradebook row. Line items and score scales cover the
 * whole offering; results cover the supplied published marks plus one final
 * grade result per student.
 */
export function buildOneRosterGradebook(input: OneRosterInput): OneRosterGradebook {
  const { offering, assessments, students, results, finalGrades, lastModified } = input

  const lineItems: OneRosterLineItemRow[] = assessments.map((assessment) => ({
    sourcedId: lineItemSourcedId(assessment.id),
    status: ONE_ROSTER_STATUS_ACTIVE,
    dateLastModified: lastModified,
    title: assessment.title,
    description: assessment.description ?? "",
    // The frozen schema has no assign date, so it mirrors `dueDate` (documented).
    assignDate: assessment.dueDate,
    dueDate: assessment.dueDate,
    classSourcedId: offering.id,
    courseSourcedId: offering.courseId,
    category: assessment.category,
    resultValueMin: 0,
    resultValueMax: assessment.maxMarks,
    scoreScaleSourcedId: scoreScaleSourcedId(assessment.id),
  }))

  lineItems.push({
    sourcedId: finalLineItemSourcedId(offering.id),
    status: ONE_ROSTER_STATUS_ACTIVE,
    dateLastModified: lastModified,
    title: `${offering.courseCode} final grade`,
    description: "Weighted final grade computed from published assessment grades.",
    assignDate: lastModified,
    dueDate: lastModified,
    classSourcedId: offering.id,
    courseSourcedId: offering.courseId,
    category: ONE_ROSTER_FINAL_CATEGORY,
    resultValueMin: 0,
    resultValueMax: 100,
    scoreScaleSourcedId: finalScoreScaleSourcedId(offering.id),
  })

  const resultRows: OneRosterResultRow[] = results.map((result) => ({
    sourcedId: resultSourcedId(result.assessmentId, result.studentId),
    status: ONE_ROSTER_STATUS_ACTIVE,
    dateLastModified: result.dateLastModified,
    lineItemSourcedId: lineItemSourcedId(result.assessmentId),
    studentSourcedId: result.studentId,
    score: result.points,
    scoreStatus: ONE_ROSTER_SCORE_STATUS_GRADED,
    resultValue: formatCsvNumber(result.points),
    comment: result.comment ?? "",
  }))

  for (const finalGrade of finalGrades) {
    resultRows.push({
      sourcedId: finalResultSourcedId(finalGrade.studentId),
      status: ONE_ROSTER_STATUS_ACTIVE,
      dateLastModified: finalGrade.dateLastModified,
      lineItemSourcedId: finalLineItemSourcedId(offering.id),
      studentSourcedId: finalGrade.studentId,
      score: finalGrade.percentage,
      scoreStatus: ONE_ROSTER_SCORE_STATUS_GRADED,
      resultValue: formatCsvNumber(finalGrade.percentage),
      comment: "",
    })
  }

  const scoreScales: OneRosterScoreScaleRow[] = assessments.map((assessment) => ({
    sourcedId: scoreScaleSourcedId(assessment.id),
    status: ONE_ROSTER_STATUS_ACTIVE,
    dateLastModified: lastModified,
    title: `${assessment.title} score scale`,
    type: ONE_ROSTER_NUMERIC_SCALE,
    minimum: 0,
    maximum: assessment.maxMarks,
  }))

  scoreScales.push({
    sourcedId: finalScoreScaleSourcedId(offering.id),
    status: ONE_ROSTER_STATUS_ACTIVE,
    dateLastModified: lastModified,
    title: `${offering.courseCode} final grade score scale`,
    type: ONE_ROSTER_NUMERIC_SCALE,
    minimum: 0,
    maximum: 100,
  })

  // `students` is accepted so callers pass the roster context even when a
  // student has no results yet; it is intentionally not emitted as a row here
  // (OneRoster keeps users in users.csv, out of the gradebook scope).
  void students

  return { lineItems, results: resultRows, scoreScales }
}

/** Serialize one gradebook file, headers first, RFC 4180 escaped. */
export function serializeOneRosterCsv(
  file: keyof OneRosterGradebook,
  gradebook: OneRosterGradebook,
): string {
  const header = ONE_ROSTER_HEADERS[file]
  if (file === "lineItems") {
    const rows = gradebook.lineItems.map((row) => [
      row.sourcedId,
      row.status,
      row.dateLastModified,
      row.title,
      row.description,
      row.assignDate,
      row.dueDate,
      row.classSourcedId,
      row.courseSourcedId,
      row.category,
      row.resultValueMin,
      row.resultValueMax,
      row.scoreScaleSourcedId,
    ])
    return toCsv([header, ...rows])
  }

  if (file === "results") {
    const rows = gradebook.results.map((row) => [
      row.sourcedId,
      row.status,
      row.dateLastModified,
      row.lineItemSourcedId,
      row.studentSourcedId,
      formatCsvNumber(row.score),
      row.scoreStatus,
      row.resultValue,
      row.comment,
    ])
    return toCsv([header, ...rows])
  }

  const rows = gradebook.scoreScales.map((row) => [
    row.sourcedId,
    row.status,
    row.dateLastModified,
    row.title,
    row.type,
    row.minimum,
    row.maximum,
  ])
  return toCsv([header, ...rows])
}
