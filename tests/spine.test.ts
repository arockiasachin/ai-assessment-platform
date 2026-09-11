import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { deterministicEmbedding } from "@/lib/llm"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/** Every table the Phase 1 schema declares in prisma/schema.prisma. */
const SPINE_TABLES = [
  "Material",
  "MaterialChunk",
  "Rubric",
  "RubricCriterion",
  "AIGradeSuggestion",
  "GradeReview",
  "Grade",
  "AuditLog",
  "Question",
  "QuestionOption",
  "QuizAttempt",
  "QuizResponse",
  "CodeTask",
  "TestCase",
  "TestRun",
  "Group",
  "GroupMember",
  "PeerEvaluation",
  "ContributionEvent",
  "Milestone",
  "SimilarityCheck",
  "SubmissionVersion",
] as const

const EMBEDDING_DIMENSIONS = 1536

/** pgvector literal; fixed notation, matching lib/vector's wire format. */
function toVectorLiteral(values: number[]): string {
  return `[${values.map((value) => value.toFixed(8)).join(",")}]`
}

describe("phase 1 assessment spine", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("applies the schema and exposes the spine tables", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT "tablename" FROM "pg_tables" WHERE "schemaname" = 'public'
    `
    const names = new Set(rows.map((row) => row.tablename))

    for (const table of SPINE_TABLES) {
      expect(names.has(table), `missing table "${table}"`).toBe(true)
    }

    // The spine tables are queryable, not merely present.
    await expect(prisma.material.count()).resolves.toBe(0)
    await expect(prisma.rubric.count()).resolves.toBe(0)
    await expect(prisma.assessment.count()).resolves.toBe(0)
  })

  it("enables pgvector and creates the MaterialChunk HNSW index", async () => {
    const extensions = await prisma.$queryRaw<{ extname: string }[]>`
      SELECT "extname" FROM "pg_extension" WHERE "extname" = 'vector'
    `
    expect(extensions).toHaveLength(1)

    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT "indexname" FROM "pg_indexes"
      WHERE "schemaname" = 'public' AND "indexname" = 'MaterialChunk_embedding_hnsw_idx'
    `
    expect(indexes).toHaveLength(1)
  })

  it("creates and reads back a minimal admin/teacher/student spine", async () => {
    const fixture = await createSpineFixture(prisma)

    expect(fixture.admin.role).toBe("ADMIN")
    expect(fixture.teacher.staffProfile?.fullName).toBe("Tara Teacher")
    expect(fixture.student.studentProfile?.registerNumber).toBe("REG-TEST-STUDENT")

    const loaded = await prisma.assessment.findUniqueOrThrow({
      where: { id: fixture.assessment.id },
      include: {
        course: true,
        createdBy: true,
        offering: { include: { teacher: true } },
      },
    })

    expect(loaded.title).toBe("Spine Test Quiz")
    expect(loaded.course.code).toBe("COURSE-SPINE-TEST")
    expect(loaded.createdBy.fullName).toBe("Tara Teacher")
    expect(loaded.offering.teacher.id).toBe(fixture.teacher.staffProfile!.id)
  })

  it("stores and retrieves MaterialChunk embeddings via pgvector", async () => {
    const fixture = await createSpineFixture(prisma)
    const material = await prisma.material.create({
      data: {
        courseId: fixture.course.id,
        title: "Cell Biology Notes",
        contentText: "Cells store genetic information in DNA inside the nucleus.",
      },
    })

    const contents = [
      "Mitochondria generate most of the cell's chemical energy.",
      "Ribosomes translate messenger RNA into proteins.",
    ]

    for (const [index, content] of contents.entries()) {
      const chunk = await prisma.materialChunk.create({
        data: {
          materialId: material.id,
          chunkIndex: index,
          content,
          embeddingModel: "mock-embedding",
        },
        select: { id: true },
      })

      const literal = toVectorLiteral(deterministicEmbedding(content, EMBEDDING_DIMENSIONS))
      await prisma.$executeRaw`
        UPDATE "MaterialChunk" SET "embedding" = ${literal}::vector WHERE "id" = ${chunk.id}
      `
    }

    const stored = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "MaterialChunk" WHERE "embedding" IS NOT NULL
    `
    expect(Number(stored[0].count)).toBe(contents.length)

    const query = contents[0]
    const queryVector = toVectorLiteral(deterministicEmbedding(query, EMBEDDING_DIMENSIONS))
    const hits = await prisma.$queryRaw<{ chunkId: string; content: string; similarity: number }[]>`
      SELECT
        "id" AS "chunkId",
        "content" AS "content",
        (1 - ("embedding" <=> ${queryVector}::vector))::float8 AS "similarity"
      FROM "MaterialChunk"
      WHERE "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${queryVector}::vector
      LIMIT 1
    `

    expect(hits).toHaveLength(1)
    expect(hits[0].content).toBe(query)
    expect(Number(hits[0].similarity)).toBeGreaterThan(0.99)
  })
})
