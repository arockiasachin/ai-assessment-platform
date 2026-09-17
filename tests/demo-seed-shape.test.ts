import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { DEMO_IDS, seedDemo } from "@/prisma/seed-demo"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * Seed shape: **legibility, not existence.**
 *
 * This file exists because of Wave 1's three seed bugs. Every one of them passed
 * its own test, because the assertions only counted rows: "the page is not empty"
 * is satisfied by two near-identical rows that demo as broken. So nothing here
 * asserts a row count. Each assertion names a *branch of a real page* and requires
 * the seed to reach it.
 *
 * The rule this encodes: if a page can render a state, the seed should produce it.
 * Otherwise the state is only ever exercised by a unit test with a hand-built row,
 * and the demo silently shows one shape of data.
 *
 * Wave 2 covers materials here. The calendar block arrives with S6, which is the
 * other half of the same seed work.
 */

describe("demo seed — shape and legibility", () => {
  beforeAll(async () => {
    await truncateAll()
    await seedDemo()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  describe("materials", () => {
    it("covers every MaterialKind the resources page renders", async () => {
      const rows = await db.material.findMany({ select: { kind: true } })
      const kinds = new Set(rows.map((row) => row.kind))

      // `OTHER` is deliberately absent: it has no sensible demo meaning, and a row
      // invented to fill it would be the kind of padding this file guards against.
      for (const kind of ["DOCUMENT", "SLIDE_DECK", "VIDEO", "TRANSCRIPT", "LINK"]) {
        expect(kinds, `no material of kind ${kind}`).toContain(kind)
      }
      expect([...kinds].sort()).toEqual(["DOCUMENT", "LINK", "SLIDE_DECK", "TRANSCRIPT", "VIDEO"])
    })

    it("has both a course-wide material and an offering-scoped one", async () => {
      // These are the two tiers of the reader's scope. With only one tier the
      // other branch is unreachable from the UI and only a DB test would cover it.
      const courseWide = await db.material.count({ where: { offeringId: null } })
      const offeringScoped = await db.material.count({ where: { offeringId: { not: null } } })
      expect(courseWide).toBeGreaterThan(0)
      expect(offeringScoped).toBeGreaterThan(0)
    })

    it("has both a linked material and one with no file at all", async () => {
      // Drives the "no file attached" branch and the external-link branch.
      expect(await db.material.count({ where: { sourceUrl: null } })).toBeGreaterThan(0)
      expect(await db.material.count({ where: { sourceUrl: { not: null } } })).toBeGreaterThan(0)
    })

    it("has both an indexed material and an unindexed one", async () => {
      // "Not searchable yet" is a state the page renders differently, so it must
      // be reachable from seeded data rather than only from a mapper test.
      const indexed = await db.material.count({ where: { chunks: { some: {} } } })
      const unindexed = await db.material.count({ where: { chunks: { none: {} } } })
      expect(indexed).toBeGreaterThan(0)
      expect(unindexed).toBeGreaterThan(0)
    })

    it("produces chunks the real way, so indexed materials are actually embedded", async () => {
      // If someone sets `chunks` by hand instead of calling `indexMaterial`, the
      // page says "Indexed" while quiz retrieval finds nothing. Assert the
      // embeddings, because retrieval is what "indexed" is supposed to mean.
      const embedded = await db.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS "count"
        FROM "MaterialChunk"
        WHERE "embedding" IS NOT NULL
      `
      const chunks = await db.materialChunk.count()
      expect(chunks).toBeGreaterThan(0)
      expect(Number(embedded[0].count)).toBe(chunks)
    })

    it("puts a material in the past offering so cross-offering isolation is demonstrable", async () => {
      const pastOfferingMaterials = await db.material.count({
        where: { offering: { endsOn: { lt: new Date() } } },
      })
      expect(pastOfferingMaterials).toBeGreaterThan(0)
    })

    it("leaves a student enrolled in the active offering but not the past one", async () => {
      // This is what makes the row above *demonstrable* rather than merely present.
      // With every student in both offerings, the past offering's material would
      // appear for everyone and a broken scope filter would be invisible -- the
      // exact failure mode this file exists to prevent.
      const students = await db.studentProfile.findMany({
        select: { id: true, enrollments: { select: { offering: { select: { endsOn: true } } } } },
      })

      // An offering with no end date has not ended, so it is not "past".
      const hasEnded = (endsOn: Date | null) => endsOn !== null && endsOn < new Date()
      const activeOnly = students.filter((student) => {
        const offerings = student.enrollments.map((enrollment) => enrollment.offering)
        return offerings.length > 0 && offerings.every((offering) => !hasEnded(offering.endsOn))
      })

      expect(activeOnly.length).toBeGreaterThan(0)
    })
  })

  describe("assessment release", () => {
    it("has both a released assessment and an unreleased one", async () => {
      // The two branches of assessment visibility. With every assessment released
      // the branches render identically, so a broken visibility filter would demo
      // as working -- and the teacher's view would have nothing to distinguish.
      const released = await db.assessment.count({ where: releasedAssessmentWhere() })
      const unreleased = await db.assessment.count({ where: { releasedAt: null } })

      expect(released).toBeGreaterThan(0)
      expect(unreleased).toBeGreaterThan(0)
    })

    it("does not set releasedAt from CourseOffering.resultsPublishedAt", async () => {
      // The two are different facts with different granularity, and the naming
      // exists to keep them apart. Assert the seed does not conflate them: the
      // release instant is per assessment, so the four do not share one value.
      const rows = await db.assessment.findMany({
        where: releasedAssessmentWhere(),
        select: { releasedAt: true },
      })
      const distinct = new Set(rows.map((row) => row.releasedAt?.toISOString()))

      expect(rows.length).toBeGreaterThan(1)
      expect(distinct.size).toBe(rows.length)
    })

    it("releases each assessment before its due date", async () => {
      // A release after the deadline would be a different, and wrong, story.
      const rows = await db.assessment.findMany({
        where: releasedAssessmentWhere(),
        select: { dueDate: true, releasedAt: true },
      })

      for (const row of rows) {
        expect(row.releasedAt!.getTime()).toBeLessThan(row.dueDate.getTime())
      }
    })
  })

  describe("accounts", () => {
    it("seeds one user of every role, so every surface is reachable", async () => {
      // The admin pages existed and worked, but no seeded account could open them — `/admin/*` was
      // dead in the demo, checkable only by writing a user by hand. A role with pages and no
      // account is a surface nobody can verify.
      const roles = await db.user.findMany({ select: { role: true } })
      const present = new Set(roles.map((user) => user.role))

      for (const role of ["ADMIN", "TEACHER", "STUDENT"] as const) {
        expect(present, `no seeded user with role ${role}`).toContain(role)
      }
    })
  })

  describe("calendar", () => {
    it("covers every EventType the calendar page renders", async () => {
      const rows = await db.calendarEvent.findMany({ select: { eventType: true } })
      const kinds = new Set(rows.map((row) => row.eventType))

      for (const kind of ["CLASS", "ASSESSMENT", "HOLIDAY", "REMINDER"]) {
        expect(kinds, `no calendar event of type ${kind}`).toContain(kind)
      }
    })

    it("has both a past event and a future one", async () => {
      // Without a past event, the "Upcoming" panel and the table beneath it render
      // the same rows, so neither a test nor a reviewer can tell whether the
      // upcoming filter does anything. The previous seed had four future events
      // only, which is exactly that blind spot.
      const past = await db.calendarEvent.count({ where: { startAt: { lt: new Date() } } })
      const future = await db.calendarEvent.count({ where: { startAt: { gte: new Date() } } })

      expect(past).toBeGreaterThan(0)
      expect(future).toBeGreaterThan(0)
    })

    it("has events with an endAt and events without one", async () => {
      // A class is a span; a deadline and a reminder are instants.
      expect(await db.calendarEvent.count({ where: { endAt: { not: null } } })).toBeGreaterThan(0)
      expect(await db.calendarEvent.count({ where: { endAt: null } })).toBeGreaterThan(0)
    })

    it("has an event with no offering and no class, for the em-dash location case", async () => {
      // §2.5: at least one unscoped event must exist. `exactly one` is asserted
      // below, after a second run, where that count also guards against orphans.
      const unscoped = await db.calendarEvent.count({
        where: { offeringId: null, classId: null },
      })
      expect(unscoped).toBeGreaterThan(0)
    })

    it("does not pile up events, and does not orphan them, when run twice", async () => {
      // Re-seeding inside the test is what makes this bite. A single run cannot
      // expose the bug: `truncateAll()` clears the database first, so there is
      // nothing to leak. The damage needs a *second* run, which deletes the
      // offerings and assessments while the events pointing at them survive.
      //
      // **This is the orphan guard.** `CalendarEvent`'s three links are all
      // `onDelete: SetNull`, so dropping a parent nulls the link instead of removing
      // the event. A row with every link nulled is exactly the shape of a
      // deliberately institution-wide event, so an orphan is indistinguishable from
      // a holiday and gets shown to every student as a course-less, location-less
      // `Due: …`. The seed did precisely this before stable event ids existed: every
      // run added ten events and removed none.
      //
      // Both assertions belong here rather than in separate tests. Asserting the
      // unscoped count before this re-seed would pass vacuously -- there are no
      // orphans until a second run creates them -- which is a test that cannot fail
      // in the situation it is meant to catch.
      const before = await db.calendarEvent.count()

      await seedDemo()

      expect(await db.calendarEvent.count()).toBe(before)
      expect(
        await db.calendarEvent.count({
          where: { offeringId: null, classId: null, assessmentId: null },
        }),
      ).toBe(1)
    })
  })

  describe("the demo term", () => {
    it("is a 15-week term containing today", async () => {
      // B2 established that a "teaching week" is one of a semester's 15
      // instructional weeks. A ~50-week window with every deadline at the end made a
      // weekly series empty for its first six weeks and meaningless everywhere.
      const offering = await db.courseOffering.findUniqueOrThrow({
        where: { id: DEMO_IDS.activeOfferingId },
        select: { startsOn: true, endsOn: true },
      })

      expect(offering.startsOn).not.toBeNull()
      expect(offering.endsOn).not.toBeNull()

      const weeks = Math.round(
        (offering.endsOn!.getTime() - offering.startsOn!.getTime()) / (7 * 24 * 60 * 60 * 1000),
      )
      expect(weeks).toBe(15)

      const now = new Date()
      expect(offering.startsOn!.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(offering.endsOn!.getTime()).toBeGreaterThanOrEqual(now.getTime())
    })

    it("keeps every assessment due date inside the term", async () => {
      const offering = await db.courseOffering.findUniqueOrThrow({
        where: { id: DEMO_IDS.activeOfferingId },
        select: { startsOn: true, endsOn: true },
      })
      const assessments = await db.assessment.findMany({
        where: { offeringId: DEMO_IDS.activeOfferingId },
        select: { dueDate: true },
      })

      expect(assessments.length).toBeGreaterThan(0)
      for (const assessment of assessments) {
        expect(assessment.dueDate.getTime()).toBeGreaterThanOrEqual(offering.startsOn!.getTime())
        expect(assessment.dueDate.getTime()).toBeLessThanOrEqual(offering.endsOn!.getTime())
      }
    })

    it("keeps the quiz's deadline in the future", async () => {
      // The seed delivers the quiz through the real attempt flow, and
      // `lib/quiz-attempts/eligibility.ts` blocks a new attempt once `dueDate` has
      // passed -- so a past deadline makes seeding throw rather than merely look
      // stale. This is the assertion that would catch a re-anchoring mistake.
      const quiz = await db.assessment.findUniqueOrThrow({
        where: { id: DEMO_IDS.quizAssessmentId },
        select: { dueDate: true },
      })
      expect(quiz.dueDate.getTime()).toBeGreaterThan(new Date().getTime())
    })
  })
})
