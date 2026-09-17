import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { AUDIT_PROBE_TITLE_PREFIXES, DEMO_IDS, seedDemo } from "@/prisma/seed-demo"
import { COURSES_IDS, seedCourses } from "@/prisma/seed-courses"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * A seed run must not leave probe-created calendar residue behind.
 *
 * ## The defect this pins
 *
 * The LangChain audit harness (`scripts/audit/`) creates assessments titled `AUDIT-…` while driving
 * the running app. `createAssessment` (`lib/gradebook-db.ts`) copies the assessment's title onto its
 * calendar event, and **all three** of `CalendarEvent`'s links (`classId`, `offeringId`,
 * `assessmentId`) are `onDelete: SetNull`. Deleting the probe's assessment — or the offering it hung
 * off — therefore strips the links and leaves an unscoped row, which `lib/calendar.ts` reads as
 * **institution-wide** and shows to every student. One run left 28 of them on `/student/events`, one
 * literally titled "AUDIT-A DOUBLE SUBMIT", and no seed owned them: the teardown swept only orphaned
 * `Due: …` rows, which never matched those titles.
 *
 * ## Why this file needs both seeds
 *
 * The sweep is a title-scoped orphan sweep, and the shape it must **not** touch is the unscoped
 * institution-wide holiday. `seed-courses.ts` owns one and the demo seed owns another, so the only
 * honest fixture is both seeds in one database — the same reason `seed-coexistence.test.ts` exists.
 * A previous unscoped sweep deleted the courses holiday; that regression is asserted here beside the
 * clause that could reintroduce it.
 */

describe("probe-created calendar orphans are swept", () => {
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

  it("reserves the probe title namespace explicitly", () => {
    // The prefix list is the entire safety argument: a title inside it is the harness's, and each
    // prefix is deliberate. Pinning the literal means widening the predicate is a visible change
    // rather than a quiet one — "delete every orphan" is exactly what once took a real holiday.
    expect([...AUDIT_PROBE_TITLE_PREFIXES]).toEqual(["AUDIT-"])
  })

  it("sweeps an orphaned probe-titled event and keeps both institution-wide holidays", async () => {
    // The shape the audit left behind: a title in the probe namespace with every link null, so
    // `lib/calendar.ts` cannot tell it from a holiday and shows it to every student.
    await db.calendarEvent.create({
      data: {
        id: "test-event-audit-probe-orphan",
        title: `${AUDIT_PROBE_TITLE_PREFIXES[0]}A probe orphan`,
        eventType: "ASSESSMENT",
        startAt: new Date("2026-10-15T00:00:00.000Z"),
        isUpcoming: false,
      },
    })

    await seedDemo()

    expect(
      await db.calendarEvent.findUnique({
        where: { id: "test-event-audit-probe-orphan" },
        select: { id: true },
      }),
      "an unowned, probe-titled orphan must not survive a demo re-seed",
    ).toBeNull()

    // The sweep is title-scoped, not "all three links are null": both deliberately institution-wide
    // holidays have that exact shape. The courses holiday is the previously-fixed regression, so it
    // is pinned here as well as in `seed-coexistence.test.ts`.
    expect(
      await db.calendarEvent.count({ where: { id: coursesHolidayId } }),
      "the course seed's institution-wide holiday must survive the probe sweep",
    ).toBe(1)
    expect(
      await db.calendarEvent.count({ where: { id: DEMO_IDS.midtermBreakEventId } }),
      "the demo seed's own institution-wide holiday is recreated, not swept",
    ).toBe(1)

    // And nothing unscoped survives except those two: a stronger claim than "the probe is gone",
    // because it would also catch a differently-titled orphan the sweep failed to remove.
    const unscoped = await db.calendarEvent.findMany({
      where: { offeringId: null, classId: null, assessmentId: null },
      select: { id: true },
    })
    expect(unscoped.map((row) => row.id).sort()).toEqual(
      [DEMO_IDS.midtermBreakEventId, coursesHolidayId].sort(),
    )
  })
})
