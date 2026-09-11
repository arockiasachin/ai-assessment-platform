import { describe, expect, it } from "vitest"

import { isDatabaseError } from "@/lib/api"
import { createAssessmentRequestSchema, updateOfferingRequestSchema } from "@/lib/contracts"

/**
 * Regression coverage for input-validation gaps that previously reached Prisma
 * and produced raw `PrismaClientValidationError` responses (with internal file
 * paths) or silently coerced input.
 */
describe("assessment creation input validation", () => {
  const valid = {
    title: "Week 4 Quiz",
    offeringId: "offering-1",
    type: "Quiz" as const,
    date: "2026-12-01",
    maxMarks: 20,
  }

  it("accepts a well-formed body", () => {
    expect(createAssessmentRequestSchema.safeParse(valid).success).toBe(true)
  })

  it("requires the offering id instead of an ambiguous course id", () => {
    const withoutOffering = { ...valid } as Partial<typeof valid>
    delete withoutOffering.offeringId
    expect(createAssessmentRequestSchema.safeParse(withoutOffering).success).toBe(false)
    // A bare course id is no longer accepted: it cannot identify the class.
    expect(
      createAssessmentRequestSchema.safeParse({ ...valid, offeringId: undefined, courseId: "c1" })
        .success,
    ).toBe(false)
  })

  it("rejects an unparseable date before it reaches Prisma", () => {
    const parsed = createAssessmentRequestSchema.safeParse({ ...valid, date: "not-a-date" })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0].message).toBe("Invalid date.")
  })

  it("rejects decimal and out-of-range max marks", () => {
    expect(createAssessmentRequestSchema.safeParse({ ...valid, maxMarks: 10.5 }).success).toBe(
      false,
    )
    expect(
      createAssessmentRequestSchema.safeParse({ ...valid, maxMarks: 9_999_999_999 }).success,
    ).toBe(false)
    expect(createAssessmentRequestSchema.safeParse({ ...valid, maxMarks: 0 }).success).toBe(false)
  })
})

describe("offering schedule input validation", () => {
  it("rejects an unparseable date instead of silently clearing the field", () => {
    const parsed = updateOfferingRequestSchema.safeParse({
      studentLimit: 30,
      registrationOpenAt: "garbage",
    })
    expect(parsed.success).toBe(false)
  })

  it("still allows explicit nulls to clear a date", () => {
    const parsed = updateOfferingRequestSchema.safeParse({
      studentLimit: 30,
      registrationOpenAt: null,
      endsOn: "2026-12-01T00:00:00.000Z",
    })
    expect(parsed.success).toBe(true)
  })
})

describe("isDatabaseError", () => {
  it("recognises Prisma errors by name and by code", () => {
    const byName = Object.assign(new Error("Invalid `prisma.x` invocation"), {
      name: "PrismaClientValidationError",
    })
    expect(isDatabaseError(byName)).toBe(true)

    const byCode = Object.assign(new Error("unique constraint"), { code: "P2002" })
    expect(isDatabaseError(byCode)).toBe(true)

    expect(isDatabaseError(new Error("Forbidden"))).toBe(false)
    expect(isDatabaseError(null)).toBe(false)
    expect(isDatabaseError("boom")).toBe(false)
  })
})
