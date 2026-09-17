import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { DEMO_IDS, seedDemo } from "@/prisma/seed-demo"
import { COURSES_IDS, seedCourses } from "@/prisma/seed-courses"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * The two seeds must not delete each other's data.
 *
 * ## Why this needs its own file
 *
 * Both seeds are developed against separate fixtures and both pass their own tests, so nothing in
 * either suite could see this: the demo's test truncates first, and the courses' test truncates
 * first, so **neither ever runs with the other's rows present**. The defect only existed in the
 * overlap — which is exactly the state a development database is in after seeding both.
 *
 * The specific failure: `seed-demo.ts`'s teardown swept every calendar event whose three links were
 * null, on the reasoning that "this seed recreates its own". That held while the demo was the only
 * producer of an institution-wide event. `seed-courses.ts` is a second, so running the demo
 * re-seed deleted the courses seed's mid-semester holiday. Observed before the fix: 39 courses
 * events → 38, restored to 39 only by re-running the courses seed.
 *
 * This test seeds **both**, then re-runs each and asserts the other's unscoped event survives. It is
 * the only place that can catch a regression, because it is the only place the two coexist.
 */

const COURSES_EVENT_PREFIX = "courses-event-"

describe("the demo and course seeds coexist", () => {
  /** Resolved from the seed's own id list, so the test cannot drift from the seed's literal. */
  let coursesHolidayId: string

  beforeAll(async () => {
    await truncateAll()
    await seedDemo()
    await seedCourses()

    coursesHolidayId = (
      await db.calendarEvent.findFirstOrThrow({
        where: { id: { in: COURSES_IDS.calendarEventIds }, eventType: "HOLIDAY" },
        select: { id: true },
      })
    ).id
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("has both institution-wide events after seeding both", async () => {
    // The `onDelete: SetNull` shape: an event with no offering, class or assessment is
    // indistinguishable from a deliberate institution-wide one, which is what makes it the
    // collision point.
    const unscoped = await db.calendarEvent.findMany({
      where: { offeringId: null, classId: null, assessmentId: null },
      select: { id: true },
    })

    expect(unscoped.map((row) => row.id).sort()).toEqual(
      [DEMO_IDS.midtermBreakEventId, coursesHolidayId].sort(),
    )
  })

  it("a demo re-seed leaves the course seed's holiday alone", async () => {
    // The regression. The demo's teardown is where the unscoped sweep lived; before the fix this
    // deleted the course seed's holiday and the assertion below failed.
    const before = await db.calendarEvent.count({
      where: { id: { startsWith: COURSES_EVENT_PREFIX } },
    })

    await seedDemo()

    expect(
      await db.calendarEvent.findUnique({ where: { id: coursesHolidayId }, select: { id: true } }),
      "the course seed's institution-wide holiday must survive a demo re-seed",
    ).not.toBeNull()
    expect(
      await db.calendarEvent.count({ where: { id: { startsWith: COURSES_EVENT_PREFIX } } }),
      "no course-seed event should be removed by a demo re-seed",
    ).toBe(before)
  })

  it("a course re-seed leaves the demo's holiday and course data alone", async () => {
    const demoEvents = await db.calendarEvent.count({
      where: { id: { startsWith: "demo-event-" } },
    })
    const demoCourses = await db.course.count({ where: { code: { startsWith: "DEMO-" } } })

    await seedCourses()

    expect(
      await db.calendarEvent.findUnique({
        where: { id: DEMO_IDS.midtermBreakEventId },
        select: { id: true },
      }),
    ).not.toBeNull()
    expect(await db.calendarEvent.count({ where: { id: { startsWith: "demo-event-" } } })).toBe(
      demoEvents,
    )
    expect(await db.course.count({ where: { code: { startsWith: "DEMO-" } } })).toBe(demoCourses)
  })

  it("still sweeps an orphaned deadline, which is the cleanup the scoping kept", async () => {
    // Scoping the sweep to the deadline shape must not have removed its actual job. A `Due: …` event
    // with every link nulled is the orphan that reads as a deadline for a course that does not exist,
    // so it is re-created here and must be gone after a re-seed.
    await db.calendarEvent.create({
      data: {
        id: "demo-event-orphan-probe",
        title: "Due: an assessment that no longer exists",
        eventType: "ASSESSMENT",
        startAt: new Date("2026-10-01T08:00:00.000Z"),
        isUpcoming: false,
      },
    })

    await seedDemo()

    expect(
      await db.calendarEvent.findUnique({
        where: { id: "demo-event-orphan-probe" },
        select: { id: true },
      }),
      "an orphaned deadline with no links should still be swept",
    ).toBeNull()
    // And the two legitimate unscoped events are still there, so the sweep is targeted rather than
    // indiscriminate in the other direction.
    expect(await db.calendarEvent.count({ where: { id: coursesHolidayId } })).toBe(1)
    expect(await db.calendarEvent.count({ where: { id: DEMO_IDS.midtermBreakEventId } })).toBe(1)
  })
})
