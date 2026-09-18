import { NextResponse } from "next/server"

import { jsonError } from "@/lib/api"
import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { supportsTextSubmission } from "@/lib/assessment-submission-rules"
import {
  AttachmentUploadError,
  MAX_ATTACHMENT_BYTES,
  extractAttachment,
  validateAttachment,
  type AttachmentFormat,
} from "@/lib/attachment-upload"
import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"
import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"
import { createStorageKey, getStorage } from "@/lib/storage"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ assessmentId: string }> }

/** A MIME type the serving route can send for a format whose declared type was generic. */
function canonicalMimeType(format: AttachmentFormat, declared: string): string {
  const clean = declared.trim().toLowerCase()
  if (clean && clean !== "application/octet-stream") return clean
  if (format === "pdf") return "application/pdf"
  if (format === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  return "text/plain"
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string"
  )
}

/**
 * `POST /api/student/assessments/[assessmentId]/attachment` — upload one file
 * for a written assessment and get its text back for the editor.
 *
 * The creation half of the attachment pipeline; the serving half is
 * `GET /api/submissions/[submissionId]/attachment/[attachmentId]`. This route:
 *
 * 1. resolves the released, enrolled, text-submittable assessment, refusing a
 *    missing, unreleased or foreign one with the same 404 `"Assessment not
 *    found."` the submission route returns (TN-69) — so it is never an oracle
 *    for assessments a student cannot see;
 * 2. validates the file by **magic bytes**, not extension (`lib/attachment-upload`);
 * 3. extracts DOCX/PDF/TXT/MD into sanitized HTML for the editor, keeping the
 *    original bytes;
 * 4. writes the file to storage and records a `SubmissionAttachment` row.
 *
 * A `Submission` row is created as a `DRAFT` when the student has never saved
 * one, because an attachment must hang off a submission. A `GRADED` submission
 * is refused exactly as the submission route refuses it — a graded record is
 * immutable to the student.
 */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("student")
  if (!auth.authorized) return auth.response

  const student = await prisma.studentProfile.findUnique({
    where: { userId: auth.user.id },
    select: { id: true },
  })
  if (!student) return jsonError("Student profile not found", 404)

  const { assessmentId } = await context.params
  if (!assessmentId) return jsonError("Assessment is required.", 400)

  /*
   * The same assessment lookup, release predicate and enrollment fold as
   * `app/api/student/assessments/[assessmentId]/submission/route.ts`. Those
   * files are siblings and must answer identically: a route that answered 403
   * for an enrolled-but-foreign assessment would confirm that an assessment the
   * list never offered exists (TN-69).
   */
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, ...releasedAssessmentWhere() },
    select: {
      id: true,
      title: true,
      type: true,
      offeringId: true,
      offering: {
        select: {
          enrollments: {
            where: { studentId: student.id, status: "active" },
            select: { id: true },
          },
        },
      },
    },
  })

  if (!assessment) return jsonError("Assessment not found.", 404)
  if (assessment.offering.enrollments.length === 0) {
    return jsonError("Assessment not found.", 404)
  }
  if (!supportsTextSubmission(assessment.type)) {
    return jsonError("Only written assessments support file uploads.", 409)
  }

  // Same gate as the submission route, so an upload cannot become a way to
  // prepare work for an assessment the student is blocked from submitting.
  const fatGate = await evaluateFatGateForStudent({
    offeringId: assessment.offeringId,
    assessmentId: assessment.id,
    studentId: student.id,
  })
  if (!fatGate.allowed) return jsonError(fatGate.message, 403)

  const existing = await prisma.submission.findUnique({
    where: { assessmentId_studentId: { assessmentId, studentId: student.id } },
    select: { id: true, status: true },
  })
  if (existing?.status === "GRADED") {
    return jsonError("This submission has already been graded and can no longer be changed.", 409)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError("Upload the file as multipart/form-data with a 'file' field.", 400)
  }

  const file = form.get("file")
  if (!isUploadedFile(file)) return jsonError("Attach a file to upload.", 400)

  /*
   * Size is checked from the multipart metadata first so an oversized body is
   * not copied into a buffer; `validateAttachment` re-checks the real byte
   * length, which is authoritative.
   */
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return jsonError(
      `That file is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB upload limit.`,
      413,
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    const format = validateAttachment({
      filename: file.name,
      declaredMimeType: file.type || null,
      bytes,
    })
    const extracted = await extractAttachment({ format, filename: file.name, bytes })

    // Only now that the file is known good do we create the draft row it hangs
    // off. A rejected file must leave no submission behind.
    const submission =
      existing ??
      (await prisma.submission.create({
        data: { assessmentId, studentId: student.id, status: "DRAFT" },
        select: { id: true, status: true },
      }))

    const storage = getStorage()
    const storageKey = createStorageKey(submission.id)
    await storage.put(storageKey, bytes, { contentType: file.type || undefined })

    let attachment: {
      id: string
      filename: string | null
      mimeType: string | null
      sizeBytes: number
      createdAt: Date
    }
    try {
      attachment = await prisma.submissionAttachment.create({
        data: {
          submissionId: submission.id,
          filename: file.name,
          mimeType: canonicalMimeType(format, file.type),
          sizeBytes: bytes.byteLength,
          storageKey,
        },
        select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
      })
    } catch (error) {
      // The bytes are already on disk. A row that never landed would leave an
      // orphan object that nothing points at and no later sweep would find, so
      // it is removed before the failure is rethrown.
      await storage.delete(storageKey).catch(() => undefined)
      throw error
    }

    return NextResponse.json({
      success: true,
      message: `Extracted ${extracted.wordCount} word${extracted.wordCount === 1 ? "" : "s"} from ${file.name}.`,
      attachment,
      content: {
        html: extracted.html,
        format: extracted.format,
        wordCount: extracted.wordCount,
        textLength: extracted.textLength,
        warnings: extracted.warnings,
      },
    })
  } catch (error) {
    if (error instanceof AttachmentUploadError) {
      return jsonError(error.message, error.status)
    }
    throw error
  }
}
