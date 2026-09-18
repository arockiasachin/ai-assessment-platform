import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The attachment *creation* path: `POST …/assessment/[assessmentId]/attachment`.
 *
 * Covers the three things the serving route's own tests do not: the file is
 * validated by magic bytes, the bytes land on disk with a `SubmissionAttachment`
 * row pointing at them, and the extracted text comes back for the editor. Its
 * refusals must also match the submission route's — a missing, unreleased or
 * foreign assessment is the same 404 body (TN-69), so this endpoint is not an
 * oracle.
 *
 * Only the session plumbing is mocked, exactly as in the sibling route tests.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST } from "@/app/api/student/assessments/[assessmentId]/attachment/route"
import { GET as getAttachment } from "@/app/api/submissions/[submissionId]/attachment/[attachmentId]/route"
import { signSessionValue } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { buildMinimalDocx } from "./helpers/documents"
import { createSpineFixture } from "./fixtures/spine"

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

let storageDir: string

function signInAs(user: { id: string; email: string; role: string } | null) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => (user ? { name, value: signSessionValue(user as never) } : undefined),
  })
}

function uploadRequest(
  assessmentId: string,
  file: { filename: string; mimeType: string; bytes: Uint8Array },
) {
  const form = new FormData()
  form.append("file", new File([file.bytes], file.filename, { type: file.mimeType }))
  return POST(
    new Request(`https://app.test/api/student/assessments/${assessmentId}/attachment`, {
      method: "POST",
      body: form,
    }),
    { params: Promise.resolve({ assessmentId }) },
  )
}

async function seedWrittenAssessment(options: { released?: boolean } = {}) {
  const fixture = await createSpineFixture(prisma)
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: "Upload Essay",
      type: "ASSIGNMENT",
      dueDate: new Date("2027-01-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: fixture.teacher.staffProfile!.id,
      releasedAt: options.released === false ? null : new Date("2026-09-01T08:00:00.000Z"),
    },
  })
  await prisma.enrollment.create({
    data: {
      studentId: fixture.student.studentProfile!.id,
      offeringId: fixture.offering.id,
      status: "active",
    },
  })
  signInAs({
    id: fixture.student.id,
    email: fixture.student.email,
    role: "student",
  })
  return { fixture, assessment }
}

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "upload-route-"))
  process.env.SUBMISSION_STORAGE_DIR = storageDir
})

afterAll(async () => {
  delete process.env.SUBMISSION_STORAGE_DIR
  await rm(storageDir, { recursive: true, force: true })
  await disconnectTestDatabase()
})

beforeEach(async () => {
  await truncateAll()
  mocks.getCookies.mockReset()
})

describe("POST /api/student/assessments/[assessmentId]/attachment", () => {
  it("stores the bytes, records the row, and returns the extracted content", async () => {
    const { fixture, assessment } = await seedWrittenAssessment()
    const bytes = buildMinimalDocx(["Extracted from a DOCX", "Second paragraph"])

    const response = await uploadRequest(assessment.id, {
      filename: "essay.docx",
      mimeType: DOCX_MIME,
      bytes,
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      attachment: { id: string; filename: string; sizeBytes: number; storageKey?: string }
      content: { html: string; format: string; wordCount: number }
    }
    expect(body.success).toBe(true)
    expect(body.content.format).toBe("docx")
    expect(body.content.html).toContain("Extracted from a DOCX")
    expect(body.content.wordCount).toBe(6)

    const attachment = await prisma.submissionAttachment.findFirstOrThrow({
      where: { id: body.attachment.id },
      include: { submission: true },
    })
    expect(attachment.filename).toBe("essay.docx")
    expect(attachment.mimeType).toBe(DOCX_MIME)
    expect(attachment.sizeBytes).toBe(bytes.byteLength)
    expect(attachment.storageKey).toBeTruthy()
    // The upload created the draft row the attachment hangs off.
    expect(attachment.submission.status).toBe("DRAFT")
    expect(attachment.submission.studentId).toBe(fixture.student.studentProfile!.id)

    // The file is physically on disk under the storage root, byte for byte.
    const onDisk = await readFile(join(storageDir, attachment.storageKey!))
    expect(onDisk.equals(Buffer.from(bytes))).toBe(true)

    // And the existing serving route can return it to its owner.
    const served = await getAttachment(
      new Request(
        `https://app.test/api/submissions/${attachment.submissionId}/attachment/${attachment.id}`,
      ),
      {
        params: Promise.resolve({
          submissionId: attachment.submissionId,
          attachmentId: attachment.id,
        }),
      },
    )
    expect(served.status).toBe(200)
    expect(Buffer.from(await served.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true)
  })

  it("attaches to an existing draft rather than creating a second submission", async () => {
    const { fixture, assessment } = await seedWrittenAssessment()
    const existing = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: fixture.student.studentProfile!.id,
        status: "DRAFT",
        contentText: "<p>already written</p>",
      },
    })

    const response = await uploadRequest(assessment.id, {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("more notes", "utf8"),
    })

    expect(response.status).toBe(200)
    expect(await prisma.submission.count({ where: { assessmentId: assessment.id } })).toBe(1)
    const attachment = await prisma.submissionAttachment.findFirstOrThrow()
    expect(attachment.submissionId).toBe(existing.id)
  })

  it("refuses a file whose extension lies and writes nothing", async () => {
    const { fixture, assessment } = await seedWrittenAssessment()

    const response = await uploadRequest(assessment.id, {
      filename: "notes.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("plain text wearing a .pdf name", "utf8"),
    })

    expect(response.status).toBe(400)
    const body = (await response.json()) as { message: string }
    expect(body.message).toMatch(/are plain text, but the name is not a \.txt or \.md name/)

    // A rejected upload leaves no attachment, no submission, and no file.
    expect(await prisma.submissionAttachment.count()).toBe(0)
    expect(
      await prisma.submission.count({
        where: { assessmentId: assessment.id, studentId: fixture.student.studentProfile!.id },
      }),
    ).toBe(0)
  })

  it("refuses a graded submission, like the submission route", async () => {
    const { fixture, assessment } = await seedWrittenAssessment()
    await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: fixture.student.studentProfile!.id,
        status: "GRADED",
        contentText: "<p>graded</p>",
      },
    })

    const response = await uploadRequest(assessment.id, {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("late addition", "utf8"),
    })

    expect(response.status).toBe(409)
    expect(await prisma.submissionAttachment.count()).toBe(0)
  })

  it("refuses an unreleased assessment with the same 404 body as a missing one", async () => {
    const { assessment } = await seedWrittenAssessment({ released: false })

    const unreleased = await uploadRequest(assessment.id, {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hidden", "utf8"),
    })
    const missing = await uploadRequest("no-such-assessment-zzz", {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hidden", "utf8"),
    })

    expect(unreleased.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await unreleased.text()).toBe(await missing.text())
    expect(await prisma.submissionAttachment.count()).toBe(0)
  })

  it("refuses a non-written assessment without reading the body", async () => {
    const { fixture } = await seedWrittenAssessment()
    const quiz = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "A Quiz",
        type: "QUIZ",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: fixture.teacher.staffProfile!.id,
        releasedAt: new Date("2026-09-01T08:00:00.000Z"),
      },
    })

    const response = await uploadRequest(quiz.id, {
      filename: "notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("text", "utf8"),
    })

    expect(response.status).toBe(409)
    expect(await prisma.submissionAttachment.count()).toBe(0)
  })
})
