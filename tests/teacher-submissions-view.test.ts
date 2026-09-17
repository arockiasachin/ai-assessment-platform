import { describe, expect, it } from "vitest"

import type { TeacherSubmissionRow } from "@/lib/teacher-submissions"
import {
  buildSubmissionSaveBody,
  feedbackDraftValue,
  scoreDraftValue,
  submissionAnchorId,
  submissionBodyText,
  toSubmissionEditorItem,
  validateScoreInput,
} from "@/lib/teacher-submissions-view"

/**
 * The submissions editor's mapping and input rules.
 *
 * These cover the change that let the editor stop fetching on mount (`docs/quality/a11y-perf-audit.md`,
 * P2). The two projections were not identical — the route the editor used to call filtered its grades
 * to published-only, while `listSubmissionsForTeacher` deliberately does not, because the submissions
 * *queue* needs to tell "not marked" from "marked, withheld". The tests pin that the editor's
 * behaviour is **unchanged** by the move to server props, so the refactor cannot quietly start
 * revealing withheld marks on a grading screen.
 */

const ROW: TeacherSubmissionRow = {
  id: "sub_1",
  studentId: "stu_1",
  studentName: "Aarav Mehta",
  registerNumber: "REG-1",
  assessmentId: "asm_1",
  assessmentTitle: "Describing a linear model",
  courseCode: "DEMO-MATH-101",
  courseName: "Algebra Foundations",
  className: "Grade 10 A",
  kind: "DESCRIPTIVE",
  state: "SUBMITTED",
  dueDate: "2026-09-12T09:00:00.000Z",
  submittedAt: "2026-09-10T09:00:00.000Z",
  gradedAt: null,
  points: null,
  maxPoints: 30,
  published: false,
  feedback: null,
  versionCount: 2,
  contentText: "y = 2x + 1",
  studentEmail: "aarav@test.local",
}

function row(overrides: Partial<TeacherSubmissionRow> = {}): TeacherSubmissionRow {
  return { ...ROW, ...overrides }
}

describe("toSubmissionEditorItem", () => {
  it("maps the identity, assessment and submission fields", () => {
    const item = toSubmissionEditorItem(row())

    expect(item.id).toBe("sub_1")
    expect(item.status).toBe("SUBMITTED")
    expect(item.student).toEqual({
      id: "stu_1",
      fullName: "Aarav Mehta",
      registerNumber: "REG-1",
      email: "aarav@test.local",
    })
    expect(item.assessment).toEqual({
      id: "asm_1",
      title: "Describing a linear model",
      type: "DESCRIPTIVE",
      dueDate: "2026-09-12T09:00:00.000Z",
      maxMarks: 30,
      courseCode: "DEMO-MATH-101",
      courseName: "Algebra Foundations",
      className: "Grade 10 A",
    })
    expect(item.contentText).toBe("y = 2x + 1")
  })

  it("keeps the real assessment kind rather than a Quiz/Assignment collapse", () => {
    // The route collapsed the type; the reader does not. The editor should not regress to the
    // narrower vocabulary now that it is fed from the reader.
    expect(toSubmissionEditorItem(row({ kind: "GROUP_PROJECT" })).assessment.type).toBe(
      "GROUP_PROJECT",
    )
  })

  it("shows a released mark", () => {
    const item = toSubmissionEditorItem(row({ points: 21, published: true }))

    expect(item.score).toBe(21)
    expect(item.published).toBe(true)
  })

  it("hides a withheld mark from the score field, as the route did", () => {
    // The behaviour-preserving case. `listSubmissionsForTeacher` returns the withheld mark because
    // the queue needs it; the editor previously never saw it, and must not start now by accident.
    const item = toSubmissionEditorItem(row({ points: 21, published: false }))

    expect(item.score).toBeNull()
    expect(item.score).not.toBe(21)
    // The distinction is still carried, so it can be surfaced deliberately later.
    expect(item.published).toBe(false)
  })

  it("keeps an unmarked submission at null, never zero", () => {
    const item = toSubmissionEditorItem(row({ points: null, published: false }))

    expect(item.score).toBeNull()
    expect(item.score).not.toBe(0)
  })

  it("normalises a missing register number to an empty string", () => {
    // The render site interpolates it into a parenthesised suffix, so `null` would print "()".
    expect(toSubmissionEditorItem(row({ registerNumber: null })).student.registerNumber).toBe("")
  })
})

describe("scoreDraftValue", () => {
  it("falls back to the row's mark when the teacher has not typed", () => {
    // This is what lets the rows live in props rather than state: no mount-time copy, so a
    // `router.refresh()` after a save updates the view without an effect syncing props into state.
    const item = toSubmissionEditorItem(row({ points: 21, published: true }))

    expect(scoreDraftValue(item, undefined)).toBe("21")
  })

  it("prefers a typed draft, including one that clears the field", () => {
    const item = toSubmissionEditorItem(row({ points: 21, published: true }))

    expect(scoreDraftValue(item, "18")).toBe("18")
    // An empty string is a real edit — "clear this mark" — not an absent draft.
    expect(scoreDraftValue(item, "")).toBe("")
  })

  it("shows an empty field for an unmarked or withheld submission", () => {
    expect(scoreDraftValue(toSubmissionEditorItem(row()), undefined)).toBe("")
    expect(
      scoreDraftValue(toSubmissionEditorItem(row({ points: 21, published: false })), undefined),
    ).toBe("")
  })
})

describe("feedbackDraftValue", () => {
  it("falls back to the row's feedback, then to an empty string", () => {
    const withFeedback = toSubmissionEditorItem(row({ feedback: "Well argued." }))
    const withoutFeedback = toSubmissionEditorItem(row({ feedback: null }))

    expect(feedbackDraftValue(withFeedback, undefined)).toBe("Well argued.")
    expect(feedbackDraftValue(withoutFeedback, undefined)).toBe("")
    expect(feedbackDraftValue(withFeedback, "Changed")).toBe("Changed")
  })
})

describe("submissionBodyText", () => {
  it("never renders an empty string", () => {
    expect(submissionBodyText(toSubmissionEditorItem(row({ contentText: null })))).toBe(
      "No text submitted.",
    )
    expect(submissionBodyText(toSubmissionEditorItem(row({ contentText: "   " })))).toBe(
      "No text submitted.",
    )
    expect(submissionBodyText(toSubmissionEditorItem(row({ contentText: "y = 2x" })))).toBe(
      "y = 2x",
    )
  })
})

describe("validateScoreInput", () => {
  it("accepts a mark within the ceiling", () => {
    expect(validateScoreInput("21", 30)).toEqual({ ok: true, score: 21 })
    expect(validateScoreInput("0", 30)).toEqual({ ok: true, score: 0 })
    expect(validateScoreInput("30", 30)).toEqual({ ok: true, score: 30 })
  })

  it("treats an empty field as clearing the mark, not as an error", () => {
    // Clearing a mark is a legitimate submission; the route's `PUT` accepts `score: null` for it.
    expect(validateScoreInput("", 30)).toEqual({ ok: true, score: null })
    expect(validateScoreInput("   ", 30)).toEqual({ ok: true, score: null })
  })

  it("refuses a value above the ceiling, a negative, and a non-number", () => {
    expect(validateScoreInput("31", 30).ok).toBe(false)
    expect(validateScoreInput("-1", 30).ok).toBe(false)
    expect(validateScoreInput("abc", 30).ok).toBe(false)
  })

  it("names the ceiling in the message, so the teacher sees the real bound", () => {
    const result = validateScoreInput("31", 30)
    expect(result.ok === false && result.message).toContain("30")
  })

  it("accepts a fractional mark, which the column stores", () => {
    // `Grade.points` is a decimal, and rubric scoring produces halves.
    expect(validateScoreInput("21.5", 30)).toEqual({ ok: true, score: 21.5 })
  })
})

describe("submissionAnchorId", () => {
  it("is a stable DOM id the queue can link to", () => {
    // The submissions queue's "Open" links to `/teacher/assignments#<id>`; the card in the
    // editor uses the same helper, so the two cannot drift (TN-38).
    expect(submissionAnchorId("sub_1")).toBe("submission-sub_1")
  })
})

describe("buildSubmissionSaveBody", () => {
  it("omits the score entirely when the teacher did not touch it (TN-45)", () => {
    // This is the fix: a feedback-only save must not send `score: null`, which the route
    // reads as a deliberate un-grade and which reverted a LATE/DRAFT submission to SUBMITTED.
    const item = toSubmissionEditorItem(row({ state: "LATE", feedback: null }))
    const built = buildSubmissionSaveBody({
      submissionId: item.id,
      scoreDraft: undefined,
      feedbackDraft: "Good work",
      item,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body).toEqual({ submissionId: "sub_1", feedback: "Good work" })
    expect("score" in built.body).toBe(false)
  })

  it("sends an edited score", () => {
    const item = toSubmissionEditorItem(row())
    const built = buildSubmissionSaveBody({
      submissionId: item.id,
      scoreDraft: "21",
      feedbackDraft: undefined,
      item,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.score).toBe(21)
  })

  it("treats an emptied score field as a deliberate clear", () => {
    // An empty string is a real edit — "clear this mark" — not an absent draft.
    const item = toSubmissionEditorItem(row({ points: 21, published: true }))
    const built = buildSubmissionSaveBody({
      submissionId: item.id,
      scoreDraft: "",
      feedbackDraft: undefined,
      item,
    })

    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.body.score).toBeNull()
  })

  it("refuses an out-of-range score before any request is sent", () => {
    const item = toSubmissionEditorItem(row())
    const built = buildSubmissionSaveBody({
      submissionId: item.id,
      scoreDraft: "31",
      feedbackDraft: undefined,
      item,
    })

    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.message).toContain("30")
  })
})
