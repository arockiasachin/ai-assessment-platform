import { describe, expect, it } from "vitest"

import { PartialUpdateError, partialUpdate } from "@/lib/partial-update"

/**
 * Unit coverage for the presence-aware partial-update helper. These tests pin
 * the three states the two shipped data-loss bugs confused — omitted, explicit
 * `null`, and present — plus the allow-list and transform contract.
 */

type Request = {
  name?: string
  projectTitle?: string | null
  status?: "FORMING" | "ACTIVE" | "ARCHIVED"
  dueDate?: string | null
  addStudentIds?: string[]
  /** Not a column; must never reach the write. */
  removeStudentIds?: string[]
}

describe("partialUpdate", () => {
  it("returns an empty object when every field is omitted", () => {
    const data = partialUpdate({} satisfies Request, {
      name: true,
      projectTitle: true,
      status: true,
    })
    expect(data).toEqual({})
    expect(Object.keys(data)).toHaveLength(0)
  })

  it("copies only the present value", () => {
    const data = partialUpdate({ name: "Team A" } satisfies Request, {
      name: true,
      projectTitle: true,
      status: true,
    })
    expect(data).toEqual({ name: "Team A" })
  })

  it("keeps an explicit null so a nullable column is cleared", () => {
    const data = partialUpdate({ projectTitle: null } satisfies Request, {
      name: true,
      projectTitle: true,
    })
    expect(data).toEqual({ projectTitle: null })
    expect("projectTitle" in data).toBe(true)
  })

  it("treats an explicitly undefined field as omitted", () => {
    const data = partialUpdate({ name: undefined, status: "ACTIVE" } satisfies Request, {
      name: true,
      status: true,
    })
    expect(data).toEqual({ status: "ACTIVE" })
    expect("name" in data).toBe(false)
  })

  it("ignores request keys that are not on the allow-list", () => {
    const request: Request = {
      name: "Team A",
      addStudentIds: ["student-1"],
      removeStudentIds: ["student-2"],
    }
    const data = partialUpdate(request, { name: true, projectTitle: true, status: true })
    expect(data).toEqual({ name: "Team A" })
    // The non-column roster fields never leak into the write payload.
    expect("addStudentIds" in data).toBe(false)
    expect("removeStudentIds" in data).toBe(false)
  })

  it("applies a transform to a present value", () => {
    const data = partialUpdate({ dueDate: "2026-10-01T00:00:00.000Z" } satisfies Request, {
      dueDate: (value) => new Date(value),
    })
    expect(data.dueDate).toBeInstanceOf(Date)
    expect(data.dueDate?.toISOString()).toBe("2026-10-01T00:00:00.000Z")
  })

  it("passes an explicit null through a transform as null", () => {
    const data = partialUpdate({ dueDate: null } satisfies Request, {
      dueDate: (value) => (value === null ? null : new Date(value)),
    })
    expect(data).toEqual({ dueDate: null })
  })

  it("throws a PartialUpdateError naming the field when a transform rejects a value", () => {
    const run = () =>
      partialUpdate({ dueDate: "not-a-date" } satisfies Request, {
        dueDate: (value) => {
          const parsed = new Date(value)
          if (Number.isNaN(parsed.getTime())) throw new Error("Invalid date.")
          return parsed
        },
      })

    expect(run).toThrow(PartialUpdateError)
    try {
      run()
      expect.unreachable("expected partialUpdate to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(PartialUpdateError)
      expect((error as PartialUpdateError).field).toBe("dueDate")
      expect((error as PartialUpdateError).message).toContain("dueDate")
      expect((error as PartialUpdateError).message).toContain("Invalid date.")
    }
  })

  it("omits a field when its transform opts out with undefined", () => {
    const data = partialUpdate({ name: "keep me out" } satisfies Request, {
      name: () => undefined,
      projectTitle: true,
    })
    expect(data).toEqual({})
  })

  it("builds a Prisma-shaped payload from a realistic partial request", () => {
    const request: Request = {
      projectTitle: "Peer review project",
      status: "ACTIVE",
      addStudentIds: ["student-1"],
    }
    const data = partialUpdate(request, {
      name: true,
      projectTitle: true,
      status: true,
    })
    expect(data).toEqual({ projectTitle: "Peer review project", status: "ACTIVE" })
  })
})
