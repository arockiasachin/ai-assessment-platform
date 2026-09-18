import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The attachment serving route, against the real database and the real
 * local-disk driver.
 *
 * The load-bearing assertion is the repo's refusal invariant (TN-69): an
 * attachment a caller may not see and an attachment that does not exist must
 * answer identically — same status *and* byte-identical body —
 * (`tests/helpers/refusal.ts`), so the endpoint cannot be used to confirm that a
 * submission or an attachment exists. It is asserted at both layers: on the
 * route response the client actually receives, and on the service via
 * `captureRefusal`/`expectIndistinguishable`.
 *
 * Only the session plumbing is mocked, exactly as in the other route tests.
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

import { GET } from "@/app/api/submissions/[submissionId]/attachment/[attachmentId]/route"
import { signSessionValue } from "@/lib/session"
import { createLocalDiskStorage, createStorageKey } from "@/lib/storage"
import { loadSubmissionAttachmentForActor } from "@/lib/submission-attachments"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { captureRefusal, expectIndistinguishable } from "./helpers/refusal"

const FILE_BYTES = Buffer.from("%PDF-1.4 fake attachment bytes for the route test")
const FILE_NAME = "essay-draft.pdf"
const FILE_MIME = "application/pdf"

let storageDir: string
let storage: ReturnType<typeof createLocalDiskStorage>

function useSession(user: { id: string; email: string; role: string } | null) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => (user ? { name, value: signSessionValue(user as never) } : undefined),
  })
}

function getAttachment(submissionId: string, attachmentId: string) {
  return GET(
    new Request(`https://app.test/api/submissions/${submissionId}/attachment/${attachmentId}`),
    { params: Promise.resolve({ submissionId, attachmentId }) },
  )
}

async function buildFixture() {
  const teacherA = await prisma.user.create({
    data: {
      email: "att-teacher-a@att.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Tara Owner", empId: "EMP-ATT-A" } },
    },
    include: { staffProfile: true },
  })
  const teacherB = await prisma.user.create({
    data: {
      email: "att-teacher-b@att.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Boris Foreign", empId: "EMP-ATT-B" } },
    },
    include: { staffProfile: true },
  })
  const studentA = await prisma.user.create({
    data: {
      email: "att-student-a@att.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Sam Owner", registerNumber: "REG-ATT-A" } },
    },
    include: { studentProfile: true },
  })
  const studentB = await prisma.user.create({
    data: {
      email: "att-student-b@att.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Wren Peer", registerNumber: "REG-ATT-B" } },
    },
    include: { studentProfile: true },
  })

  const course = await prisma.course.create({
    data: { code: "COURSE-ATT-TEST", name: "Attachments Test Course" },
  })
  const classroom = await prisma.classRoom.create({
    data: { code: "CLASS-ATT-TEST", name: "Attachment Class", academicYear: 2026 },
  })
  const offering = await prisma.courseOffering.create({
    data: {
      courseId: course.id,
      classId: classroom.id,
      teacherId: teacherA.staffProfile!.id,
      term: "Term-Att-Test",
      academicYear: 2026,
    },
  })
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: offering.id,
      courseId: course.id,
      classId: classroom.id,
      title: "Attachment Essay",
      type: "ASSIGNMENT",
      dueDate: new Date("2026-10-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: teacherA.staffProfile!.id,
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })

  // Both students are enrolled: a peer *inside* the offering must still be
  // refused, which is the stronger form of the student check.
  await prisma.enrollment.createMany({
    data: [
      { studentId: studentA.studentProfile!.id, offeringId: offering.id, status: "active" },
      { studentId: studentB.studentProfile!.id, offeringId: offering.id, status: "active" },
    ],
  })

  const submission = await prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      studentId: studentA.studentProfile!.id,
      status: "SUBMITTED",
      contentText: "The owning student's essay.",
    },
  })
  const storageKey = createStorageKey(submission.id)
  await storage.put(storageKey, FILE_BYTES)
  const attachment = await prisma.submissionAttachment.create({
    data: {
      submissionId: submission.id,
      filename: FILE_NAME,
      mimeType: FILE_MIME,
      sizeBytes: FILE_BYTES.byteLength,
      storageKey,
    },
  })

  // A second submission (another student, same assessment), so "real id, wrong
  // submission" is testable.
  const submissionB = await prisma.submission.create({
    data: {
      assessmentId: assessment.id,
      studentId: studentB.studentProfile!.id,
      status: "SUBMITTED",
      contentText: "The peer's essay.",
    },
  })

  // A purged attachment: the row survives as provenance, the content is gone.
  const purgedAttachment = await prisma.submissionAttachment.create({
    data: {
      submissionId: submission.id,
      filename: null,
      mimeType: null,
      sizeBytes: FILE_BYTES.byteLength,
      storageKey: null,
      purgedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  })

  return {
    teacherA,
    teacherB,
    studentA,
    studentB,
    offering,
    assessment,
    submission,
    submissionB,
    attachment,
    purgedAttachment,
  }
}

let f: Awaited<ReturnType<typeof buildFixture>>

beforeAll(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "attachment-route-"))
  process.env.SUBMISSION_STORAGE_DIR = storageDir
  storage = createLocalDiskStorage(storageDir)
})

afterAll(async () => {
  delete process.env.SUBMISSION_STORAGE_DIR
  await rm(storageDir, { recursive: true, force: true })
  await disconnectTestDatabase()
})

beforeEach(async () => {
  await truncateAll()
  mocks.getCookies.mockReset()
  f = await buildFixture()
})

describe("GET /api/submissions/[submissionId]/attachment/[attachmentId]", () => {
  it("serves the bytes to a teacher who owns the offering", async () => {
    useSession({ id: f.teacherA.id, email: f.teacherA.email, role: "teacher" })

    const response = await getAttachment(f.submission.id, f.attachment.id)

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe(FILE_MIME)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain(FILE_NAME)
    expect(Buffer.from(await response.arrayBuffer()).equals(FILE_BYTES)).toBe(true)
  })

  it("serves the bytes to the owning student", async () => {
    useSession({ id: f.studentA.id, email: f.studentA.email, role: "student" })

    const response = await getAttachment(f.submission.id, f.attachment.id)

    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(FILE_BYTES)).toBe(true)
  })

  it("refuses anonymous callers with 401 and admins with 403, before any lookup", async () => {
    useSession(null)
    expect((await getAttachment(f.submission.id, f.attachment.id)).status).toBe(401)

    useSession({ id: "att-admin", email: "admin@att.test", role: "admin" })
    expect((await getAttachment(f.submission.id, f.attachment.id)).status).toBe(403)
  })

  it("answers a foreign teacher and a missing attachment identically (byte-for-byte)", async () => {
    useSession({ id: f.teacherB.id, email: f.teacherB.email, role: "teacher" })

    const foreign = await getAttachment(f.submission.id, f.attachment.id)
    const missing = await getAttachment(f.submission.id, "no-such-attachment")

    const foreignBody = await foreign.text()
    const missingBody = await missing.text()

    expect(foreign.status, `foreign body: ${foreignBody}`).toBe(404)
    expect(missing.status, `missing body: ${missingBody}`).toBe(404)
    expect(foreignBody).toBe(missingBody)
    expect(JSON.parse(foreignBody)).toEqual({ success: false, message: "Attachment not found." })
  })

  it("answers an enrolled peer student and a missing attachment identically", async () => {
    useSession({ id: f.studentB.id, email: f.studentB.email, role: "student" })

    const foreign = await getAttachment(f.submission.id, f.attachment.id)
    const missing = await getAttachment(f.submission.id, "no-such-attachment")

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await foreign.text()).toBe(await missing.text())
  })

  it("answers a real attachment under the wrong submission identically to a missing one", async () => {
    useSession({ id: f.teacherA.id, email: f.teacherA.email, role: "teacher" })

    // `attachment.id` is real, but it belongs to `submissionB`.
    const wrongSubmission = await getAttachment(f.submissionB.id, f.attachment.id)
    const missing = await getAttachment(f.submissionB.id, "no-such-attachment")

    expect(wrongSubmission.status).toBe(404)
    expect(await wrongSubmission.text()).toBe(await missing.text())
  })

  it("refuses a purged attachment exactly like a missing one", async () => {
    useSession({ id: f.teacherA.id, email: f.teacherA.email, role: "teacher" })

    const purged = await getAttachment(f.submission.id, f.purgedAttachment.id)
    const missing = await getAttachment(f.submission.id, "no-such-attachment")

    expect(purged.status).toBe(404)
    expect(await purged.text()).toBe(await missing.text())
  })

  it("refuses a non-existent submission identically to a non-existent attachment", async () => {
    useSession({ id: f.teacherA.id, email: f.teacherA.email, role: "teacher" })

    const missingSubmission = await getAttachment("no-such-submission", "no-such-attachment")
    const missingAttachment = await getAttachment(f.submission.id, "no-such-attachment")

    expect(missingSubmission.status).toBe(404)
    expect(await missingSubmission.text()).toBe(await missingAttachment.text())
  })
})

describe("loadSubmissionAttachmentForActor — the refusal invariant at the service layer", () => {
  it("makes a foreign attachment and a missing one indistinguishable (TN-69)", async () => {
    const foreignTeacher = { id: f.teacherB.id, email: f.teacherB.email, role: "teacher" as const }
    const peerStudent = { id: f.studentB.id, email: f.studentB.email, role: "student" as const }

    const foreignForTeacher = await captureRefusal(
      loadSubmissionAttachmentForActor(foreignTeacher, f.submission.id, f.attachment.id),
    )
    const missingForTeacher = await captureRefusal(
      loadSubmissionAttachmentForActor(foreignTeacher, f.submission.id, "no-such-attachment"),
    )
    expectIndistinguishable(foreignForTeacher, missingForTeacher)

    const foreignForStudent = await captureRefusal(
      loadSubmissionAttachmentForActor(peerStudent, f.submission.id, f.attachment.id),
    )
    const missingForStudent = await captureRefusal(
      loadSubmissionAttachmentForActor(peerStudent, f.submission.id, "no-such-attachment"),
    )
    expectIndistinguishable(foreignForStudent, missingForStudent)

    expect(foreignForTeacher).toEqual({ status: 404, message: "Attachment not found." })
  })
})
