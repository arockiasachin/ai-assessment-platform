import { describe, expect, it } from "vitest"

import {
  commonAvailability,
  formTeams,
  isScheduleCompatible,
  type FormationCriterion,
  type FormationStudent,
} from "@/lib/groups/formation"

/**
 * Team formation: the CATME "maximise the worst-fitting team" objective, hard
 * schedule constraints, deterministic output.
 */

function student(
  studentId: string,
  attributes: Record<string, string | number> = {},
  availability?: string[],
): FormationStudent {
  return { studentId, attributes, availability }
}

const BALANCE: FormationCriterion = {
  id: "gpa",
  label: "GPA balance",
  kind: "numeric-balance",
  weight: 1,
  attribute: "gpa",
}

const DIVERSITY: FormationCriterion = {
  id: "major",
  label: "Major mix",
  kind: "categorical-diversity",
  weight: 1,
  attribute: "major",
}

describe("formTeams", () => {
  it("maximises the worst-fitting team rather than settling for round-robin", () => {
    // Skills 1,2,3,4 over two teams. Round-robin gives means 2 and 3 (score
    // 0.667 each); the maximin objective is 1.0 with the balanced pairing.
    const result = formTeams({
      students: [
        student("s1", { gpa: 1 }),
        student("s2", { gpa: 2 }),
        student("s3", { gpa: 3 }),
        student("s4", { gpa: 4 }),
      ],
      criteria: [BALANCE],
      teamCount: 2,
    })

    expect(result.teams).toHaveLength(2)
    expect(result.objective).toBeCloseTo(1, 5)
    const teamOf = (id: string) =>
      result.teams.find((team) => team.memberIds.includes(id))?.memberIds
    expect(teamOf("s1")).toEqual(teamOf("s4"))
    expect(teamOf("s2")).toEqual(teamOf("s3"))
    expect(teamOf("s1")).not.toEqual(teamOf("s2"))
  })

  it("is deterministic for the same input", () => {
    const input = {
      students: [
        student("a", { gpa: 1 }),
        student("b", { gpa: 2 }),
        student("c", { gpa: 3 }),
        student("d", { gpa: 4 }),
        student("e", { gpa: 5 }),
        student("f", { gpa: 6 }),
      ],
      criteria: [BALANCE],
      teamCount: 3,
    }
    const first = formTeams(input)
    const second = formTeams(input)
    expect(second.teams.map((team) => team.memberIds)).toEqual(
      first.teams.map((team) => team.memberIds),
    )
    expect(second.objective).toBeCloseTo(first.objective, 10)
  })

  it("rewards categorical diversity and renormalises weighted criteria", () => {
    const result = formTeams({
      students: [
        student("a", { major: "CS" }),
        student("b", { major: "CS" }),
        student("c", { major: "EE" }),
        student("d", { major: "EE" }),
      ],
      criteria: [DIVERSITY],
      teamCount: 2,
    })
    expect(result.objective).toBeCloseTo(1, 5)
    for (const team of result.teams) {
      const majors = team.memberIds.map((id) => (id === "a" || id === "b" ? "CS" : "EE"))
      expect(new Set(majors).size).toBe(2)
    }
  })

  it("never forms a team with incompatible schedules", () => {
    const result = formTeams({
      students: [
        student("a", {}, ["Mon"]),
        student("b", {}, ["Mon"]),
        student("c", {}, ["Tue"]),
        student("d", {}, ["Tue"]),
      ],
      criteria: [BALANCE],
      teamCount: 2,
    })
    expect(result.scheduleCompatible).toBe(true)
    for (const team of result.teams) {
      expect(team.compatible).toBe(true)
      expect(team.commonAvailability.length).toBeGreaterThan(0)
    }
    const together = (x: string, y: string) =>
      result.teams.some((team) => team.memberIds.includes(x) && team.memberIds.includes(y))
    expect(together("a", "b")).toBe(true)
    expect(together("c", "d")).toBe(true)
    expect(together("a", "c")).toBe(false)
  })

  it("treats an empty availability list as never available and refuses to place the student", () => {
    expect(isScheduleCompatible([student("a", {}, []), student("b", {}, ["Mon"])])).toBe(false)
    expect(() =>
      formTeams({
        students: [student("a", {}, []), student("b", {}, ["Mon"])],
        criteria: [BALANCE],
        teamCount: 1,
      }),
    ).toThrowError(/cannot be placed in a schedule-compatible team/i)
  })

  it("treats undeclared availability as unconstrained and never blocks formation", () => {
    expect(commonAvailability([student("a"), student("b", {}, ["Mon"])])).toEqual(["Mon"])
    expect(isScheduleCompatible([student("a"), student("b", {}, ["Mon"])])).toBe(true)
    const result = formTeams({
      students: [student("a"), student("b")],
      criteria: [BALANCE],
      teamSize: 2,
    })
    expect(result.teams).toHaveLength(1)
    expect(result.objective).toBe(1)
  })

  it("fails loudly when the requested shape is impossible", () => {
    expect(() =>
      formTeams({ students: [student("a")], criteria: [BALANCE], teamCount: 1 }),
    ).toThrowError(/at least two students/i)
    expect(() => formTeams({ students: [student("a"), student("b")], criteria: [] })).toThrowError(
      /at least one formation criterion/i,
    )
    expect(() =>
      formTeams({
        students: [student("a"), student("b")],
        criteria: [BALANCE],
        teamCount: 5,
      }),
    ).toThrowError(/cannot exceed the number of students/i)
  })

  it("distributes an uneven cohort as evenly as possible", () => {
    const result = formTeams({
      students: Array.from({ length: 7 }, (_, index) => student(`s${index}`, { gpa: index })),
      criteria: [BALANCE],
      teamSize: 3,
    })
    expect(result.teamCount).toBe(3)
    const sizes = result.teams.map((team) => team.memberIds.length).sort()
    expect(sizes).toEqual([2, 2, 3])
  })
})
