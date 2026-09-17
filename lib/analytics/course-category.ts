import "server-only"

import { prisma } from "@/lib/prisma"
import { writeAuditLog } from "@/lib/grading/audit"
import type { AuthUser } from "@/lib/session"

import { AnalyticsError } from "./errors"
import {
  isCategoricallyAbsolute,
  RELATIVE_GRADING_MIN_STRENGTH,
  resolveRegimeForCourse,
  type GradingNotice,
  type GradingRegime,
  type RegimeDecision,
} from "./grading-bands"
import { gatherRegimeInputs } from "./grading-regime"
import type { CourseCategoryValue } from "@/lib/contracts/courses"

/**
 * Set and read a course's grading category — the admin-owned write path.
 *
 * ## Authorization
 *
 * The category is an **institutional fact** (VIT's Academic Regulations fix which regimes a
 * course of a given kind uses), not a per-course teaching preference — so it belongs to an
 * admin, and the write path is admin-only. An admin sets the category for *any* course; they
 * do not have to teach it, because they are acting on the institution's record rather than
 * on their own offering.
 *
 * That is why there is a single `setCourseCategoryForAdmin` entry point and **no ownership
 * check**: the earlier teacher-shaped entry point resolved ownership from
 * `CourseOffering.teacherId`, and reusing it here would have meant carrying a check the admin
 * must always fail and then bypassing it. A separate entry point states the rule directly
 * instead of encoding a bypass inside a teacher function.
 *
 * ## Audit
 *
 * Changing the category moves every student's letter in the course, so the write is
 * attributable: it records a `course.category.updated` row with **both the previous and the
 * new category**, because the change is the consequential fact, not the value alone.
 *
 * ## Why this is a write path and not a column only the seed fills
 *
 * Without it the category could never be set in a running system, so every course would
 * permanently fall back to absolute bands with a warning. A field that nothing can write is
 * not a feature.
 */

export type SetCourseCategoryResult =
  | { kind: "updated"; courseId: string; category: CourseCategoryValue; gradingEffect: string }
  | { kind: "not-found" }

/** The fallback reasons that mean "absolute bands", as declared by `resolveRegimeForCourse`. */
export type AbsoluteFallbackReason = Extract<RegimeDecision, { regime: "absolute" }>["reason"]

/** A sentence describing the consequence, so a caller does not have to re-derive the rule. */
export function describeGradingEffect(category: CourseCategoryValue): string {
  if (isCategoricallyAbsolute(category)) {
    return "Absolute bands apply at any class size, as VIT grades this category absolutely."
  }
  return `Relative bands apply once more than ${RELATIVE_GRADING_MIN_STRENGTH - 1} students have published totals; until then absolute bands are shown.`
}

/**
 * Whether setting the course's category can change this fallback.
 *
 * Only `category-unset` is a fact about the course's *record*. The others are facts that a
 * category cannot change: `non-theory-course` is permanent for that kind of course,
 * `small-class` is a statement about the headcount, and `awaiting-base-metrics` is a
 * statement about how many totals are published. An admin surface must say so, or an admin
 * who sets a category and still sees absolute bands will read correct behaviour as a bug.
 */
export function categorySettingResolvesFallback(reason: AbsoluteFallbackReason): boolean {
  return reason === "category-unset"
}

/**
 * Set the category for any course, as an admin.
 *
 * A missing course reports `not-found` rather than being created: the category is a fact
 * about an existing course, and inventing one would put a letter on a course nobody enrolled
 * in.
 */
export async function setCourseCategoryForAdmin(
  user: AuthUser,
  courseId: string,
  category: CourseCategoryValue,
): Promise<SetCourseCategoryResult> {
  if (user.role !== "admin") throw new AnalyticsError(403, "Forbidden")

  return prisma.$transaction(async (tx) => {
    const before = await tx.course.findUnique({
      where: { id: courseId },
      select: { id: true, category: true },
    })
    if (!before) return { kind: "not-found" }

    const updated = await tx.course.update({
      where: { id: courseId },
      data: { category },
      select: { id: true },
    })

    await writeAuditLog(tx, {
      entityType: "Course",
      entityId: updated.id,
      action: "course.category.updated",
      actor: { id: user.id, role: user.role },
      before: { category: before.category },
      after: { category },
    })

    return {
      kind: "updated",
      courseId: updated.id,
      category,
      gradingEffect: describeGradingEffect(category),
    }
  })
}

/** One offering's resolved regime, as the admin course list shows it. */
export type AdminCourseOfferingGrading = {
  offeringId: string
  classCode: string
  className: string
  teacherName: string
  enrolledCount: number
  publishedCount: number
  regime: GradingRegime
  /** The fallback reason when `regime` is `absolute`, otherwise `null`. */
  reason: AbsoluteFallbackReason | null
  /** The notice to render, or `null` when relative bands are in use. */
  notice: GradingNotice | null
  /** True when setting the course's category is the action that resolves this fallback. */
  categoryFixable: boolean
}

/** A course and the regime each of its offerings resolves to. */
export type AdminCourseGradingRow = {
  courseId: string
  code: string
  name: string
  /** `null` when the category has not been set — the fallback this surface can fix. */
  category: CourseCategoryValue | null
  offerings: AdminCourseOfferingGrading[]
}

function classLabel(name: string, section: string | null): string {
  return section ? `${name} ${section}` : name
}

/**
 * Every course, with its stored category and the regime each offering actually resolves to.
 *
 * The regime is resolved **per offering**, not per course, because class strength and
 * published totals are offering-scoped: two sections of one course can share a category and
 * still land on different regimes (a small section falls back, a large one does not). Rolling
 * that up to one course-level answer would hide exactly the case the admin needs to see.
 *
 * Reuses `gatherRegimeInputs`, so this read cannot disagree with the teacher analytics page
 * about what "the course's effective regime" means.
 */
export async function listCourseGradingForAdmin(): Promise<AdminCourseGradingRow[]> {
  const courses = await prisma.course.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      offerings: {
        orderBy: [{ academicYear: "desc" }, { term: "asc" }],
        select: {
          id: true,
          classRoom: { select: { code: true, name: true, section: true } },
          teacher: { select: { fullName: true } },
        },
      },
    },
  })

  return Promise.all(
    courses.map(async (course) => {
      const offerings = await Promise.all(
        course.offerings.map(async (offering): Promise<AdminCourseOfferingGrading> => {
          const inputs = await gatherRegimeInputs(offering.id)
          const decision = resolveRegimeForCourse(inputs)
          const reason = decision.regime === "absolute" ? decision.reason : null

          return {
            offeringId: offering.id,
            classCode: offering.classRoom.code,
            className: classLabel(offering.classRoom.name, offering.classRoom.section),
            teacherName: offering.teacher.fullName,
            enrolledCount: inputs.enrolledCount,
            publishedCount: inputs.publishedTotals.length,
            regime: decision.regime,
            reason,
            notice: decision.regime === "absolute" ? decision.notice : null,
            categoryFixable: reason !== null && categorySettingResolvesFallback(reason),
          }
        }),
      )

      return {
        courseId: course.id,
        code: course.code,
        name: course.name,
        category: course.category ?? null,
        offerings,
      }
    }),
  )
}
