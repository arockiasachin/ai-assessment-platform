import "server-only"

import type { MaterialKind } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

/**
 * The student's course materials.
 *
 * Nothing listed materials before this module. The only code touching these tables
 * was the write path (`lib/vector/embed.ts`) and retrieval (`lib/vector/search.ts`,
 * which needs a query string and returns chunks, not materials).
 *
 * **The scope mirrors the retriever exactly** (`lib/quiz-generation/retrieval.ts`),
 * so the list and the quiz generator agree about which material a student can be
 * quizzed on:
 *
 * - material attached to an offering the student is enrolled in, **or**
 * - course-wide material (`offeringId: null`) for a course they are enrolled in.
 *
 * `Material.offeringId` is nullable and `courseId` is not, which is what makes the
 * two branches expressible. If these ever diverge, a student could be quizzed on
 * material their own resources page does not show.
 *
 * **No index or migration was added, deliberately.** `@@index([offeringId])` serves
 * the first branch and `@@index([courseId, createdAt])` the second, because
 * `courseId` is its leading column. Adding one "just in case" would be a migration
 * bought with nothing.
 */

/**
 * The view model this module returns.
 *
 * **Named `StudentMaterialView`, not `MaterialView`.** `lib/mock/types.ts` already
 * exports a `MaterialView`, and the two are genuinely different shapes: the mockup's
 * carries three fields that no column backs. Reusing its name for a narrower type
 * would mean same name, different fields across the tree — the kind of collision
 * that makes a reader trust the wrong definition. The mockup's type is left alone
 * because the mockup still draws those three columns as a design reference.
 *
 * Three fields the mockup rendered are **absent on purpose** (decisions M1, M3 in
 * `docs/plans/wave-2.md`):
 *
 * - `topic` — there is no such column and `metadata` is empty on every row. A
 *   material has no topic; the *question* does, and retrieval searches content
 *   rather than a topic key.
 * - `sizeLabel` — no file is stored, so there is no size to report. `sourceUrl` is
 *   an external link or nothing.
 * - `state` — there is no indexing pipeline state. `indexMaterial` is synchronous:
 *   it writes every chunk or throws, so a material is indexed or it is not, which
 *   `indexed` already expresses.
 */
export type StudentMaterialView = {
  id: string
  title: string
  /** Matches `MaterialKind`; the assignment below proves the two cannot drift. */
  kind: MaterialKind
  sourceUrl: string | null
  mimeType: string | null
  /** ISO. */
  updatedAt: string
  courseCode: string
  /**
   * Whether retrieval can search it. `chunks` is a real count, so `0` is a fact
   * rather than a missing value — the em-dash rule does not apply here, and the
   * UI says "Not searchable yet" rather than showing a dash.
   */
  indexed: boolean
  chunks: number
}

/**
 * The subset of a `material.findMany` row the projection reads.
 *
 * Declared structurally so the mapper is a pure function and can be tested without
 * a database, and so the Prisma `_count` shape is flattened at the call site rather
 * than leaking into the view model.
 */
export type MaterialQueryRow = {
  id: string
  title: string
  kind: MaterialKind
  sourceUrl: string | null
  mimeType: string | null
  updatedAt: Date
  course: { code: string }
  chunks: number
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * The invariant worth naming: `chunks: 0` must produce `indexed: false` and not
 * `undefined`, because the UI branches on it to decide between "indexed" and "Not
 * searchable yet". A missing chunk count would silently render the wrong one.
 */
export function toMaterialView(row: MaterialQueryRow): StudentMaterialView {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sourceUrl: row.sourceUrl,
    mimeType: row.mimeType,
    updatedAt: row.updatedAt.toISOString(),
    courseCode: row.course.code,
    indexed: row.chunks > 0,
    chunks: row.chunks,
  }
}

/**
 * Every material a student can see, newest first.
 *
 * Returns `[]` rather than throwing when the user has no student profile. That
 * mirrors the other readers added for pages (`lib/teacher-roster.ts`,
 * `lib/teacher-submissions.ts`): a missing profile is a broken invariant, but it is
 * not worth taking a whole page down for, and the page has an honest empty state.
 */
export async function listMaterialsForStudent(user: AuthUser): Promise<StudentMaterialView[]> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return []

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId: student.id, status: "active" },
    select: { offeringId: true, offering: { select: { courseId: true } } },
  })
  if (enrollments.length === 0) return []

  const offeringIds = enrollments.map((enrollment) => enrollment.offeringId)
  const courseIds = [...new Set(enrollments.map((enrollment) => enrollment.offering.courseId))]

  const rows = await prisma.material.findMany({
    where: {
      OR: [
        // Attached to an offering the student is enrolled in.
        { offeringId: { in: offeringIds } },
        // Course-wide: explicitly not attached to any offering, but in a course
        // they are enrolled in. This is the same second tier the retriever reads.
        { offeringId: null, courseId: { in: courseIds } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      kind: true,
      sourceUrl: true,
      mimeType: true,
      updatedAt: true,
      course: { select: { code: true } },
      _count: { select: { chunks: true } },
    },
  })

  return rows.map((row) => toMaterialView({ ...row, chunks: row._count.chunks }))
}
