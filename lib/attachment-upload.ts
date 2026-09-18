import "server-only"

import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"

import { logEvent } from "@/lib/observability/event"
import {
  plainTextToSubmissionHtml,
  sanitizeSubmissionHtml,
  submissionTextLength,
  submissionWordCount,
} from "@/lib/rich-text"

/**
 * Validation and text extraction for submission uploads.
 *
 * ## Validation is by magic bytes, never by extension
 *
 * A file's extension and its browser-declared MIME type are both attacker- or
 * accident-controlled, so neither is trusted to say what the bytes are.
 * {@link detectAttachmentFormat} reads the leading bytes instead:
 *
 * - `%PDF-` → PDF;
 * - `PK\x03\x04` (a ZIP local-file header) → a DOCX candidate (DOCX is a ZIP);
 * - otherwise, bytes that are valid UTF-8 and contain no NUL → text;
 * - anything else → refused.
 *
 * The declared extension and MIME type are then checked for **consistency**
 * against that detected format, which is what makes a lying extension a refusal
 * rather than a pass: a text file named `.pdf` is detected as text and refused,
 * and a PDF named `.docx` is detected as a PDF and refused. A DOCX that is
 * merely *some* ZIP is still only a candidate — `mammoth` has to parse it before
 * it is accepted, so a renamed `.docx`-extension archive fails at extraction.
 *
 * Text formats are the honest gap: TXT and MD have no signature to read, so for
 * them "valid UTF-8 without NUL bytes plus a text extension/MIME" is the
 * strongest check available. That is stated here rather than hidden behind a
 * pretend binary signature.
 *
 * ## Extraction is lossy, deliberately
 *
 * - **DOCX** → Mammoth HTML, sanitized to the same tag set a submission can
 *   carry. Embedded images are dropped (the sanitizer has no `img`), and only
 *   paragraphs, headings, emphasis, lists and tables survive.
 * - **PDF** → plain text via `pdf-parse`, then paragraphs. Scanned or
 *   image-only PDFs yield no text and are refused with a readable message; OCR
 *   is out of scope. Text order follows the PDF's own draw order, so a
 *   multi-column layout can interleave.
 * - **TXT/MD** → text as-is. Markdown is **not** rendered; no Markdown parser is
 *   installed, so `# Heading` stays `# Heading`.
 */

/** Hard size cap: 10 MB. A submission is student prose, not a media library. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const TEXT_EXTENSIONS = [".txt", ".md"]
const DOCX_EXTENSION = ".docx"
const PDF_EXTENSION = ".pdf"

const PDF_MIME_TYPES = ["application/pdf"]
const DOCX_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // A DOCX is a ZIP; some browsers report the container rather than the format.
  // Permitted because the magic bytes and Mammoth's own parse still have to pass.
  "application/zip",
]
const TEXT_MIME_TYPES = ["text/plain", "text/markdown", "text/x-markdown"]

/**
 * MIME types a browser may send when it does not know better. Treated as
 * "unspecified" so the magic bytes decide; the declared type is still checked
 * when it *is* specific, so a PDF uploaded as `text/plain` is refused.
 */
const UNSPECIFIED_MIME_TYPES = new Set(["", "application/octet-stream"])

/** A format this route can extract from. */
export type AttachmentFormat = "pdf" | "docx" | "text"

/** What the bytes actually are, before the declared type is considered. */
export type DetectedAttachmentFormat = AttachmentFormat | "binary"

/** An upload this route must refuse. Carries an HTTP status for the route. */
export class AttachmentUploadError extends Error {
  constructor(
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message)
    this.name = "AttachmentUploadError"
  }
}

export type ExtractedAttachment = {
  /** Sanitized HTML ready to insert into the editor. */
  html: string
  format: AttachmentFormat
  /** Plain-text character count of `html` (the submission cap's unit). */
  textLength: number
  wordCount: number
  /** Non-fatal notes from the converter (Mammoth warnings, dropped content). */
  warnings: string[]
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false
  }
  return true
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]
const ZIP_EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06]
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08]

function looksLikeUtf8Text(bytes: Uint8Array): boolean {
  // A NUL byte is not valid text in any of the text formats we accept, and is a
  // cheap way to reject an executable or a binary blob wearing a `.txt` name.
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/** The format the leading bytes say this is. */
export function detectAttachmentFormat(bytes: Uint8Array): DetectedAttachmentFormat {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf"
  if (
    startsWith(bytes, ZIP_LOCAL_HEADER) ||
    startsWith(bytes, ZIP_EMPTY_ARCHIVE) ||
    startsWith(bytes, ZIP_SPANNED)
  ) {
    return "docx"
  }
  if (looksLikeUtf8Text(bytes)) return "text"
  return "binary"
}

/** The lower-cased extension including the dot, or `""` when there is none. */
export function fileExtension(filename: string): string {
  const clean = filename.trim().toLowerCase()
  const dot = clean.lastIndexOf(".")
  if (dot <= 0 || dot === clean.length - 1) return ""
  return clean.slice(dot)
}

function formatLabel(format: DetectedAttachmentFormat): string {
  if (format === "pdf") return "a PDF"
  if (format === "docx") return "a DOCX document"
  if (format === "text") return "plain text"
  return "an unsupported binary file"
}

/**
 * Validate one upload and return the format that will be extracted.
 *
 * Throws {@link AttachmentUploadError} (400 for a bad file, 413 for one over
 * {@link MAX_ATTACHMENT_BYTES}) with a message safe to show a student.
 */
export function validateAttachment(input: {
  filename: string
  declaredMimeType: string | null
  bytes: Uint8Array
}): AttachmentFormat {
  const { filename, bytes } = input
  const mime = (input.declaredMimeType ?? "").trim().toLowerCase()

  if (bytes.byteLength === 0) {
    throw new AttachmentUploadError(400, "The file is empty.")
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentUploadError(
      413,
      `That file is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB upload limit.`,
    )
  }
  if (!filename.trim()) {
    throw new AttachmentUploadError(400, "The uploaded file has no name.")
  }

  const detected = detectAttachmentFormat(bytes)
  const extension = fileExtension(filename)

  if (detected === "binary") {
    throw new AttachmentUploadError(
      400,
      "Unsupported file type. Upload a PDF, DOCX, TXT, or MD file.",
    )
  }

  if (detected === "pdf") {
    if (extension !== PDF_EXTENSION) {
      throw new AttachmentUploadError(
        400,
        `The contents of "${filename}" are ${formatLabel(detected)}, but the name is not a .pdf name. Rename it or upload the correct file.`,
      )
    }
    if (!UNSPECIFIED_MIME_TYPES.has(mime) && !PDF_MIME_TYPES.includes(mime)) {
      throw new AttachmentUploadError(
        400,
        `"${filename}" is a PDF, but it was sent as "${mime}". Upload the file as application/pdf.`,
      )
    }
    return "pdf"
  }

  if (detected === "docx") {
    if (extension !== DOCX_EXTENSION) {
      throw new AttachmentUploadError(
        400,
        `The contents of "${filename}" look like a ZIP archive (a DOCX), but the name is not a .docx name. Rename it or upload the correct file.`,
      )
    }
    if (!UNSPECIFIED_MIME_TYPES.has(mime) && !DOCX_MIME_TYPES.includes(mime)) {
      throw new AttachmentUploadError(
        400,
        `"${filename}" is a DOCX, but it was sent as "${mime}". Upload the file with its document MIME type.`,
      )
    }
    return "docx"
  }

  // detected === "text"
  if (!TEXT_EXTENSIONS.includes(extension)) {
    throw new AttachmentUploadError(
      400,
      `The contents of "${filename}" are plain text, but the name is not a .txt or .md name. Rename it or upload the correct file.`,
    )
  }
  if (!UNSPECIFIED_MIME_TYPES.has(mime) && !TEXT_MIME_TYPES.includes(mime)) {
    throw new AttachmentUploadError(
      400,
      `"${filename}" is plain text, but it was sent as "${mime}". Upload the file as text/plain or text/markdown.`,
    )
  }
  return "text"
}

async function extractDocx(bytes: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  const result = await mammoth.convertToHtml({
    buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  })
  const warnings = result.messages
    .filter((message) => message.type === "warning")
    .map((message) => message.message)
  return { html: sanitizeSubmissionHtml(result.value), warnings }
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // `pdf-parse@2` is a class, not the v1 default-export function. `pageJoiner`
  // replaces the default "\n-- 1 of 1 --\n" page marker, which is parser
  // metadata rather than document text and would otherwise be inserted as prose.
  const parser = new PDFParse({ data: new Uint8Array(bytes) })
  try {
    const result = await parser.getText({ pageJoiner: "\n" })
    return result.text
  } finally {
    await parser.destroy()
  }
}

/**
 * Extract one validated upload into sanitized HTML for the editor.
 *
 * Throws {@link AttachmentUploadError} with a readable message when a document
 * cannot be parsed or yields no text — notably a scanned PDF, which has no text
 * layer to extract and is the known limitation of this path.
 */
export async function extractAttachment(input: {
  format: AttachmentFormat
  filename: string
  bytes: Uint8Array
}): Promise<ExtractedAttachment> {
  const { format, filename, bytes } = input

  let html: string
  const warnings: string[] = []

  if (format === "docx") {
    try {
      const extracted = await extractDocx(bytes)
      html = extracted.html
      warnings.push(...extracted.warnings)
    } catch (error) {
      if (error instanceof AttachmentUploadError) throw error
      throw new AttachmentUploadError(
        400,
        `We could not read "${filename}" as a DOCX document. It may be corrupted or password-protected.`,
      )
    }
  } else if (format === "pdf") {
    let text: string
    try {
      text = await extractPdfText(bytes)
    } catch (error) {
      // A malformed or unsupported PDF is routine, not a 5xx: report the reason
      // for operators, and the student gets the readable message below.
      logEvent("warn", "attachment.pdf_extraction_failed", {
        filename,
        reason: error instanceof Error ? error.message : String(error),
      })
      throw new AttachmentUploadError(
        400,
        `We could not read "${filename}" as a PDF. It may be corrupted or password-protected.`,
      )
    }
    if (text.trim().length === 0) {
      throw new AttachmentUploadError(
        400,
        `No text could be extracted from "${filename}". It may be a scanned or image-only PDF, which is not supported — upload a text-based PDF or a DOCX/TXT file instead.`,
      )
    }
    html = sanitizeSubmissionHtml(plainTextToSubmissionHtml(text))
  } else {
    const text = new TextDecoder("utf-8").decode(bytes)
    html = sanitizeSubmissionHtml(plainTextToSubmissionHtml(text))
  }

  const textLength = submissionTextLength(html)
  if (textLength === 0) {
    throw new AttachmentUploadError(400, `No readable text could be extracted from "${filename}".`)
  }

  return {
    html,
    format,
    textLength,
    wordCount: submissionWordCount(html),
    warnings,
  }
}
