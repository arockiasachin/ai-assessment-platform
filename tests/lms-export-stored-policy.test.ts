import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getTeacherGradeExport } from "@/lib/lms-export/service"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createLmsExportFixture, lmsTeacherSession } from "./fixtures/lms-export"

/**
 * The offering's stored grading policy must actually change the export.
 *
 * This is the test that distinguishes "the policy is wired in" from "the policy is a library".
 * Before `lib/grading/offering-config.ts`, `lib/grading/policy.ts` was imported only by its own
 * test: `loadExportContext` fell back to `defaultFinalGradeConfig`, which weights every
 * assessment equally in a single category, so a stored CAT/FAT split had nowhere to land and
 * the FAT gate was never evaluated for anyone.
 *
 * So these assert on the **resolved configuration the export reports**, not on the resolver's
 * return value — the resolver was already unit-tested and passing while nothing called it.
 */

const POLICY = {
  catWeight: 40,
  fatWeight: 60,
  finalAssessmentId: null,
  minimumCatPercent: 30,
}

async function storePolicy(offeringId: string, config: object) {
  await prisma.courseOffering.update({ where: { id: offeringId }, data: { gradingConfig: config } })
}

describe("the export honours a stored grading policy", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("uses a single equal-weight category when nothing is stored", async () => {
    // The baseline this change is measured against: an unconfigured offering has no CAT/FAT
    // shape, which is why the stored policy has to be what introduces it.
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
    })

    expect(result.config.categories).toHaveLength(1)
    expect(result.config.categories[0].weight).toBe(100)
  })

  it("splits the export into CAT and FAT with the stored weights", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    await storePolicy(fixture.offering.id, POLICY)

    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
    })

    const cat = result.config.categories.find((category) => category.id === "cat")
    const fat = result.config.categories.find((category) => category.id === "fat")

    expect(result.config.categories).toHaveLength(2)
    expect(cat?.weight).toBe(40)
    expect(fat?.weight).toBe(60)
  })

  it("gives the FAT exactly one assessment and the CAT the rest", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    await storePolicy(fixture.offering.id, POLICY)

    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
    })

    const cat = result.config.categories.find((category) => category.id === "cat")
    const fat = result.config.categories.find((category) => category.id === "fat")

    // The FAT is a single assessment by definition, and the two pools must partition the
    // offering's assessments — an assessment in both, or in neither, would silently change a
    // student's total.
    expect(fat?.assessmentIds).toHaveLength(1)
    expect(cat?.assessmentIds).toHaveLength(fixture.assessments.length - 1)
    expect([...(cat?.assessmentIds ?? []), ...(fat?.assessmentIds ?? [])].sort()).toEqual(
      fixture.assessments.map((assessment) => assessment.id).sort(),
    )
  })

  it("honours the teacher's chosen final assessment over the due-date order", async () => {
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    // The first assessment is deliberately not the last to fall due.
    const chosen = fixture.assessments[0]
    await storePolicy(fixture.offering.id, { ...POLICY, finalAssessmentId: chosen.id })

    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
    })

    const fat = result.config.categories.find((category) => category.id === "fat")
    expect(fat?.assessmentIds).toEqual([chosen.id])
  })

  it("lets a request body config win over the stored policy", async () => {
    // An explicit one-off calculation still takes precedence, which is the documented order.
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    await storePolicy(fixture.offering.id, POLICY)

    const explicit = {
      categories: [
        {
          id: "everything",
          name: "Everything",
          weight: 100,
          assessmentIds: fixture.assessments.map((a) => a.id),
        },
      ],
    }
    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
      config: explicit,
    })

    expect(result.config.categories).toHaveLength(1)
    expect(result.config.categories[0].id).toBe("everything")
  })

  it("leaves an unusable stored policy at equal weighting rather than guessing a split", async () => {
    // The column is read on the export path, so a malformed value must degrade rather than
    // throw — a teacher cannot fix a row they cannot export past. It degrades to *equal
    // weighting*, not to the default CAT/FAT split: substituting a guessed split would be the
    // silent-heuristic-FAT problem again, just triggered by a corrupt row instead of an absent
    // one. The editor reports `usingDefaults`, so the teacher sees that something is wrong.
    const fixture = await createLmsExportFixture(prisma, { studentCount: 2 })
    await storePolicy(fixture.offering.id, { catWeight: "forty", fatWeight: null })

    const result = await getTeacherGradeExport(lmsTeacherSession(fixture), {
      offeringId: fixture.offering.id,
    })

    expect(result.config.categories).toHaveLength(1)
    expect(result.config.categories[0].weight).toBe(100)
  })
})
