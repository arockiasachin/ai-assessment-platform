import { jsonError } from "@/lib/api"
import { requireRole } from "@/lib/authz"
import {
  SubmissionAttachmentError,
  loadSubmissionAttachmentForActor,
} from "@/lib/submission-attachments"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ submissionId: string; attachmentId: string }> }

/**
 * Build a safe `Content-Disposition` value from a user-supplied filename.
 *
 * Node rejects a header value containing CR/LF, but the filename is still
 * untrusted: quotes and control characters are stripped, and the UTF-8 form is
 * carried in `filename*` so a non-ASCII name survives without breaking the
 * quoted-string form (RFC 6266).
 */
function contentDisposition(filename: string): string {
  const printable = filename.replace(/[\u0000-\u001f\u007f"]/g, "_").slice(0, 200)
  const ascii = printable.replace(/[^\x20-\x7e]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(printable)}`
}

/**
 * `GET /api/submissions/[submissionId]/attachment/[attachmentId]` — one
 * attachment's bytes.
 *
 * Authorization is object-level and lives in
 * `loadSubmissionAttachmentForActor`: a teacher may read an attachment on a
 * submission in an assessment they own, the owning student may read their own,
 * and every other caller — foreign submission, foreign attachment, other
 * student, purged attachment, or an id that does not exist — receives the same
 * 404 body (TN-69).
 */
export async function GET(_request: Request, context: RouteParams) {
  const auth = await requireRole("teacher", "student")
  if (!auth.authorized) return auth.response

  const { submissionId, attachmentId } = await context.params

  try {
    const attachment = await loadSubmissionAttachmentForActor(auth.user, submissionId, attachmentId)
    return new Response(new Uint8Array(attachment.bytes), {
      status: 200,
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.bytes.byteLength),
        "Content-Disposition": contentDisposition(attachment.filename),
        // The bytes are user-uploaded; never let the browser re-sniff the type.
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    if (error instanceof SubmissionAttachmentError) {
      return jsonError(error.message, error.status)
    }
    throw error
  }
}
