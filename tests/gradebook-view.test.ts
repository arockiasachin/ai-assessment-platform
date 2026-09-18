import { describe, expect, it } from "vitest"

import type { Assessment, Student } from "@/lib/gradebook"
import { parseMarkDraft, scopeGradebookToOffering } from "@/lib/gradebook-view"

function student(id: string, offeringIds?: string[]): Student {
  return {
    id,
    name: id,
    email: `${id}@test.local`,
    registerNumber: null,
    profilePicUrl: null,
    ...(offeringIds === undefined ? {} : { offeringIds }),
  }
}

function assessment(id: string, offeringId: string): Assessment {
  return {
    id,
    title: id,
    courseId: "course-1",
    courseName: "Course One",
    type: "QUIZ",
    date: "2026-10-01",
    maxMarks: 20,
    offeringId,
    classId: "class-1",
  }
}

describe("scopeGradebookToOffering", () => {
  const students = [
    student("a", ["offering-1"]),
    student("b", ["offering-2"]),
    student("c", ["offering-1", "offering-2"]),
    student("no-enrolments"),
  ]
  const assessments = [
    assessment("a1", "offering-1"),
    assessment("a2", "offering-2"),
    assessment("a3", "offering-1"),
  ]

  it("keeps only the assessments delivered by the offering", () => {
    const scope = scopeGradebookToOffering(students, assessments, "offering-1")
    expect(scope.assessments.map((a) => a.id)).toEqual(["a1", "a3"])
  })

  it("keeps only the students enrolled in the offering", () => {
    const scope = scopeGradebookToOffering(students, assessments, "offering-1")
    // `c` is enrolled in both; `b` belongs to the other offering; the unannotated student is
    // not claimed by any offering.
    expect(scope.students.map((s) => s.id)).toEqual(["a", "c"])
  })

  it("produces a rectangle whose every cell belongs to one offering", () => {
    const scope = scopeGradebookToOffering(students, assessments, "offering-2")
    const offering = "offering-2"
    expect(scope.assessments.every((a) => a.offeringId === offering)).toBe(true)
    expect(scope.students.every((s) => s.offeringIds?.includes(offering))).toBe(true)
    // The cross-product defect: before scoping the same payload pairs every student with every
    // assessment. 3 assessments × 4 students is 12 cells, of which only 2 are writable.
    expect(students.length * assessments.length).toBe(12)
    expect(scope.students.length * scope.assessments.length).toBe(2)
  })

  it("returns nothing when no offering is selected rather than guessing", () => {
    expect(scopeGradebookToOffering(students, assessments, null)).toEqual({
      students: [],
      assessments: [],
    })
    expect(scopeGradebookToOffering(students, assessments, "")).toEqual({
      students: [],
      assessments: [],
    })
  })
})

describe("parseMarkDraft", () => {
  it("treats an empty draft as an explicit clear", () => {
    expect(parseMarkDraft("", 20)).toEqual({ ok: true, score: null })
    expect(parseMarkDraft("   ", 20)).toEqual({ ok: true, score: null })
  })

  it("accepts an in-range mark, including zero", () => {
    expect(parseMarkDraft("12", 20)).toEqual({ ok: true, score: 12 })
    expect(parseMarkDraft("0", 20)).toEqual({ ok: true, score: 0 })
    expect(parseMarkDraft(" 20 ", 20)).toEqual({ ok: true, score: 20 })
  })

  it("refuses an out-of-range mark instead of clamping it (the 9999 case)", () => {
    expect(parseMarkDraft("9999", 20)).toEqual({
      ok: false,
      message: "Score must be between 0 and 20.",
    })
    // The old cell clamped this to 0 and wrote it, so the client stored a value the teacher
    // never typed and the server would have refused.
    expect(parseMarkDraft("-5", 20)).toEqual({
      ok: false,
      message: "Score must be between 0 and 20.",
    })
    expect(parseMarkDraft("20.5", 20)).toEqual({
      ok: false,
      message: "Score must be between 0 and 20.",
    })
  })

  it("refuses a non-numeric draft instead of silently dropping it (the abc case)", () => {
    // Must not become `null`: `JSON.stringify({ score: NaN })` serialises to `null`, which the
    // server reads as "clear this mark" — a silent data loss.
    expect(parseMarkDraft("abc", 20)).toEqual({ ok: false, message: "Invalid score." })
    expect(parseMarkDraft("NaN", 20)).toEqual({ ok: false, message: "Invalid score." })
    expect(parseMarkDraft("12 marks", 20)).toEqual({ ok: false, message: "Invalid score." })
  })
})
