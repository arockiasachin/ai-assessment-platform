import { describe, expect, it } from "vitest"

import {
  buildOneRosterGradebook,
  escapeCsvField,
  serializeOneRosterCsv,
  toCsv,
  type OneRosterInput,
} from "@/lib/lms-export"

/**
 * Regression coverage for bug-fix run 2: exported CSV cells that begin with a
 * spreadsheet formula trigger (`=`, `+`, `-`, `@`, tab, CR) were emitted
 * verbatim, so a crafted assessment title or free-text comment could execute
 * when the OneRoster file was opened in Excel/Sheets.
 */
describe("CSV formula injection", () => {
  it("neutralises every formula-leading character for string cells", () => {
    expect(escapeCsvField("=cmd|'/C calc'!A0")).toBe("'=cmd|'/C calc'!A0")
    expect(escapeCsvField("+SUM(A1)")).toBe("'+SUM(A1)")
    expect(escapeCsvField("-2+3")).toBe("'-2+3")
    expect(escapeCsvField("@import")).toBe("'@import")
    expect(escapeCsvField("\tstart")).toBe("'\tstart")
  })

  it("escapes quotes, commas and newlines after neutralising", () => {
    expect(escapeCsvField("=a,b")).toBe('"\'=a,b"')
    expect(escapeCsvField('=a"b')).toBe('"\'=a""b"')
  })

  it("leaves numbers — including negative ones — and benign text alone", () => {
    expect(escapeCsvField(-5)).toBe("-5")
    expect(escapeCsvField(16.5)).toBe("16.5")
    expect(escapeCsvField("plain")).toBe("plain")
    expect(escapeCsvField("Quiz 1")).toBe("Quiz 1")
    expect(escapeCsvField(null)).toBe("")
  })

  it("neutralises a formula-title in the serialized OneRoster CSV", () => {
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
          title: "=cmd|'/C calc'!A0",
          dueDate: "2026-10-01T08:00:00.000Z",
          maxMarks: 20,
          category: "Exams",
        },
      ],
      students: [{ id: "s1", fullName: "Sam", registerNumber: "R1" }],
      results: [],
      finalGrades: [],
      lastModified: "2026-11-02T10:00:00.000Z",
    }

    const csv = serializeOneRosterCsv("lineItems", buildOneRosterGradebook(input))
    expect(csv).toContain("'=cmd|'/C calc'!A0")
    expect(csv).not.toMatch(/,=cmd\|/)

    expect(toCsv([["=1+1"]])).toBe("'=1+1\r\n")
  })
})
