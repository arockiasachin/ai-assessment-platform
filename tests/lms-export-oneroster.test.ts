import { describe, expect, it } from "vitest"

import {
  ONE_ROSTER_HEADERS,
  buildOneRosterGradebook,
  escapeCsvField,
  serializeOneRosterCsv,
  toCsv,
  type OneRosterInput,
} from "@/lib/lms-export"

const input: OneRosterInput = {
  offering: {
    id: "offering-1",
    courseId: "course-1",
    courseCode: "CS101",
    courseName: "Intro",
    className: "Section A",
  },
  assessments: [
    {
      id: "a1",
      title: 'Quiz "one", part 2\nsecond line',
      dueDate: "2026-10-01T08:00:00.000Z",
      maxMarks: 20,
      category: "Exams",
    },
    {
      id: "a2",
      title: "Assignment",
      dueDate: "2026-10-08T08:00:00.000Z",
      maxMarks: 10,
      category: "Coursework",
    },
  ],
  students: [{ id: "s1", fullName: "Sam", registerNumber: "R1" }],
  results: [
    {
      assessmentId: "a1",
      studentId: "s1",
      points: 16,
      maxPoints: 20,
      dateLastModified: "2026-11-01T10:00:00.000Z",
      comment: 'first, "best"',
    },
    {
      assessmentId: "a2",
      studentId: "s1",
      points: 8,
      maxPoints: 10,
      dateLastModified: "2026-11-01T10:00:00.000Z",
    },
  ],
  finalGrades: [{ studentId: "s1", percentage: 83, dateLastModified: "2026-11-02T10:00:00.000Z" }],
  lastModified: "2026-11-02T10:00:00.000Z",
}

describe("CSV escaping", () => {
  it("quotes only when needed and doubles embedded quotes", () => {
    expect(escapeCsvField("plain")).toBe("plain")
    expect(escapeCsvField("a,b")).toBe('"a,b"')
    expect(escapeCsvField('a"b')).toBe('"a""b"')
    expect(escapeCsvField("a\nb")).toBe('"a\nb"')
    expect(escapeCsvField(null)).toBe("")
    expect(toCsv([["a", 1]])).toBe("a,1\r\n")
  })
})

describe("buildOneRosterGradebook", () => {
  it("emits line items, results and score scales with OneRoster column semantics", () => {
    const gradebook = buildOneRosterGradebook(input)

    // One line item per assessment plus the synthetic weighted final grade.
    expect(gradebook.lineItems).toHaveLength(3)
    const [quiz, assignment, finalLineItem] = gradebook.lineItems
    expect(quiz).toMatchObject({
      sourcedId: "lineitem-a1",
      status: "active",
      title: 'Quiz "one", part 2\nsecond line',
      classSourcedId: "offering-1",
      courseSourcedId: "course-1",
      category: "Exams",
      resultValueMin: 0,
      resultValueMax: 20,
      scoreScaleSourcedId: "scales-a1",
    })
    expect(assignment.category).toBe("Coursework")
    expect(finalLineItem).toMatchObject({
      sourcedId: "lineitem-final-offering-1",
      category: "Final Grade",
      resultValueMax: 100,
      scoreScaleSourcedId: "scales-final-offering-1",
    })

    // One result per published mark plus one final-grade result.
    expect(gradebook.results).toHaveLength(3)
    const [quizResult, assignmentResult, finalResult] = gradebook.results
    expect(quizResult).toMatchObject({
      sourcedId: "result-a1-s1",
      lineItemSourcedId: "lineitem-a1",
      studentSourcedId: "s1",
      score: 16,
      scoreStatus: "fully graded",
      resultValue: "16.00",
      comment: 'first, "best"',
    })
    expect(assignmentResult.score).toBe(8)
    expect(finalResult).toMatchObject({
      sourcedId: "result-final-s1",
      lineItemSourcedId: "lineitem-final-offering-1",
      score: 83,
      resultValue: "83.00",
    })

    // A numeric score scale per assessment plus one for the final grade.
    expect(gradebook.scoreScales).toHaveLength(3)
    expect(gradebook.scoreScales[0]).toMatchObject({
      sourcedId: "scales-a1",
      type: "numeric",
      minimum: 0,
      maximum: 20,
    })
    expect(gradebook.scoreScales[2]).toMatchObject({
      sourcedId: "scales-final-offering-1",
      maximum: 100,
    })
  })
})

describe("serializeOneRosterCsv", () => {
  const gradebook = buildOneRosterGradebook(input)

  it("emits the documented header row for every file", () => {
    expect(serializeOneRosterCsv("lineItems", gradebook).split("\r\n")[0]).toBe(
      ONE_ROSTER_HEADERS.lineItems.join(","),
    )
    expect(serializeOneRosterCsv("results", gradebook).split("\r\n")[0]).toBe(
      ONE_ROSTER_HEADERS.results.join(","),
    )
    expect(serializeOneRosterCsv("scoreScales", gradebook).split("\r\n")[0]).toBe(
      ONE_ROSTER_HEADERS.scoreScales.join(","),
    )
    expect(ONE_ROSTER_HEADERS.results).toEqual([
      "sourcedId",
      "status",
      "dateLastModified",
      "lineItem",
      "student",
      "score",
      "scoreStatus",
      "resultValue",
      "comment",
    ])
  })

  it("escapes quotes, commas and embedded newlines in free text", () => {
    const csv = serializeOneRosterCsv("lineItems", gradebook)
    expect(csv).toContain('"Quiz ""one"", part 2\nsecond line"')
    expect(csv).not.toContain('Quiz "one", part 2') // the raw unescaped value never appears

    const results = serializeOneRosterCsv("results", gradebook)
    expect(results).toContain('"first, ""best"""')
  })

  it("terminates the document with CRLF", () => {
    const csv = serializeOneRosterCsv("scoreScales", gradebook)
    expect(csv.endsWith("\r\n")).toBe(true)
  })
})
