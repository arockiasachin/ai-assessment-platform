import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { StorageObjectNotFoundError, getStorage } from "@/lib/storage"
import { resolveTeacherStaffId, teacherOwnsAssessment } from "@/lib/teacher-staff"

/**
 * Reading a `SubmissionAttachment`'s bytes for a signed-in actor.
 *
 * Object-level ownership, alongside the route's `requireRole`:
 *
 * - a **teacher** may read an attachment on a submission whose assessment they
 *   own (they created it, or they teach its offering);
 * - a **student** may read only an attachment on their **own** submission;
 * - everyone else is refused.
 *
 * THE REFUSAL INVARIANT (TN-69)
 * -----------------------------
 * A foreign attachment, an attachment on someone else's submission, a purged
 * attachment, and an attachment id that does not exist at all all throw the
 * **same** {@link SubmissionAttachmentError} — status 404, message
 * "Attachment not found." The route turns that into one response, so a caller
 * cannot use the endpoint to learn whether an attachment (or a submission) they
 * may not see exists. This is the rule stated in `lib/assessment-release.ts` and
 * asserted with `tests/helpers/refusal.ts`.
 *
 * A purged attachment is folded into the same refusal rather than reported as a
 * distinct "gone" status, for the same reason: `410 Gone` would confirm that the
 * row exists.
 *
 * The authorization decision is made **before** any storage read, so a refused
 * caller never causes a file to be fetched — and a storage failure for an
 * authorized caller is not silently converted into an authorization answer.
 */

/** Statuses this pod can refuse with. */
export type SubmissionAttachmentStatus = 400 | 403 | 404

/** An attachment read that must not succeed. Carries an HTTP status for the route. */
export class SubmissionAttachmentError extends Error {
  constructor(
    readonly status: SubmissionAttachmentStatus,
    message: string,
  ) {
    super(message)
    this.name = "SubmissionAttachmentError"
  }
}

/**
 * The one refusal for an object the caller may not see. A factory so each throw
 * gets its own error instance, while the status and message stay byte-identical.
 */
function notFound(): SubmissionAttachmentError {
  return new SubmissionAttachmentError(404, "Attachment not found.")
}

export type SubmissionAttachmentContent = {
  attachmentId: string
  submissionId: string
  filename: string
  mimeType: string
  sizeBytes: number
  bytes: Buffer
}

type ActorScope = { kind: "teacher"; staffId: string } | { kind: "student"; studentId: string }

/**
 * Resolve the acting user to the profile id ownership is decided from, or refuse.
 *
 * A missing staff/student profile is a 403, not a 404: it says the *session* is
 * unusable, and it is reached before any object lookup, so it cannot be used to
 * probe whether an id exists.
 */
async function resolveActorScope(actor: AuthUser): Promise<ActorScope> {
  if (actor.role === "teacher") {
    const staffId = await resolveTeacherStaffId(actor.id)
    if (!staffId) throw new SubmissionAttachmentError(403, "Teacher profile not found.")
    return { kind: "teacher", staffId }
  }

  if (actor.role === "student") {
    const student = await prisma.studentProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    })
    if (!student) throw new SubmissionAttachmentError(403, "Student profile not found.")
    return { kind: "student", studentId: student.id }
  }

  throw new SubmissionAttachmentError(403, "Forbidden")
}

/**
 * Load one attachment's metadata and bytes for `actor`, or throw
 * {@link SubmissionAttachmentError}.
 *
 * The lookup is scoped by **both** ids, so an attachment that exists under a
 * different submission is treated exactly as a nonexistent attachment.
 */
export async function loadSubmissionAttachmentForActor(
  actor: AuthUser,
  submissionId: string,
  attachmentId: string,
): Promise<SubmissionAttachmentContent> {
  const scope = await resolveActorScope(actor)

  const attachment = await prisma.submissionAttachment.findFirst({
    where: { id: attachmentId, submissionId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      purgedAt: true,
      submission: {
        select: {
          studentId: true,
          assessment: {
            select: {
              createdById: true,
              offering: { select: { teacherId: true } },
            },
          },
        },
      },
    },
  })

  if (!attachment) throw notFound()

  // Redacted by the retention purge: the pointer and metadata are gone and the
  // stored file has been removed. Refuse identically to a missing object.
  if (
    attachment.purgedAt ||
    !attachment.storageKey ||
    !attachment.filename ||
    !attachment.mimeType
  ) {
    throw notFound()
  }

  const allowed =
    scope.kind === "teacher"
      ? teacherOwnsAssessment(attachment.submission.assessment, scope.staffId)
      : scope.studentId === attachment.submission.studentId

  if (!allowed) throw notFound()

  let bytes: Buffer
  try {
    bytes = await getStorage().get(attachment.storageKey)
  } catch (error) {
    // An authorized row whose file is missing is a data inconsistency; it is
    // reported as not-found rather than 500, without confirming the row existed.
    if (error instanceof StorageObjectNotFoundError) throw notFound()
    throw error
  }

  return {
    attachmentId: attachment.id,
    submissionId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    bytes,
  }
}
