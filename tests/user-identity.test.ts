import { describe, expect, it } from "vitest"

import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

/**
 * The real `User` model has no name column, so the shell derives what it can
 * from the email. These are the two derivations it relies on.
 */
describe("initialsFromEmail", () => {
  it("uses the first two local-part words when separated", () => {
    expect(initialsFromEmail("meera.raman@vit.ac.in")).toBe("MR")
    expect(initialsFromEmail("aarav_mehta@vitstudent.ac.in")).toBe("AM")
    expect(initialsFromEmail("ada-okonkwo@vit.ac.in")).toBe("AO")
    expect(initialsFromEmail("a.b+tag@example.com")).toBe("AB")
  })

  it("falls back to the first two characters of a single-word local part", () => {
    expect(initialsFromEmail("admin@vit.ac.in")).toBe("AD")
  })

  it("never throws or renders an empty avatar", () => {
    expect(initialsFromEmail("")).toBe("?")
    expect(initialsFromEmail("@vit.ac.in")).toBe("?")
    expect(initialsFromEmail("...@vit.ac.in")).toBe("?")
  })

  it("ignores digits-free separator noise and uppercases", () => {
    expect(initialsFromEmail("j.doe@example.com")).toBe("JD")
  })
})

describe("roleLabelFromRole", () => {
  it("title-cases the session role", () => {
    expect(roleLabelFromRole("teacher")).toBe("Teacher")
    expect(roleLabelFromRole("student")).toBe("Student")
    expect(roleLabelFromRole("admin")).toBe("Admin")
  })

  it("is safe on an empty role", () => {
    expect(roleLabelFromRole("")).toBe("")
  })
})
