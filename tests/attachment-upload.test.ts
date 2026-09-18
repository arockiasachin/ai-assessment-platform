import { describe, expect, it } from "vitest"

import {
  AttachmentUploadError,
  MAX_ATTACHMENT_BYTES,
  detectAttachmentFormat,
  extractAttachment,
  fileExtension,
  validateAttachment,
} from "@/lib/attachment-upload"
import { buildMinimalDocx, buildMinimalPdf } from "./helpers/documents"

/**
 * Magic-byte validation and extraction for uploads.
 *
 * The point of validating by magic bytes rather than extension is that a lying
 * name must be refused, which is asserted directly: a text file named `.pdf`, a
 * PDF named `.docx`, and a `.txt` whose contents are a PDF are all rejected.
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

describe("detectAttachmentFormat", () => {
  it("recognises a PDF by its %PDF- signature", () => {
    expect(detectAttachmentFormat(buildMinimalPdf("hello"))).toBe("pdf")
  })

  it("recognises a DOCX by its ZIP header", () => {
    expect(detectAttachmentFormat(buildMinimalDocx(["hello"]))).toBe("docx")
  })

  it("treats valid UTF-8 without NUL bytes as text", () => {
    expect(detectAttachmentFormat(Buffer.from("plain notes", "utf8"))).toBe("text")
  })

  it("rejects binary bytes and NUL-containing data", () => {
    expect(detectAttachmentFormat(Buffer.from([0xff, 0xfe, 0x00, 0x01]))).toBe("binary")
    expect(detectAttachmentFormat(Buffer.from("text\0with nul", "utf8"))).toBe("binary")
  })
})

describe("fileExtension", () => {
  it("lower-cases and keeps the dot", () => {
    expect(fileExtension("Essay.DOCX")).toBe(".docx")
    expect(fileExtension("notes")).toBe("")
    expect(fileExtension(".hidden")).toBe("")
  })
})

describe("validateAttachment", () => {
  it("accepts a real PDF, DOCX, and TXT/MD", () => {
    expect(
      validateAttachment({
        filename: "essay.pdf",
        declaredMimeType: "application/pdf",
        bytes: buildMinimalPdf("hello"),
      }),
    ).toBe("pdf")
    expect(
      validateAttachment({
        filename: "essay.docx",
        declaredMimeType: DOCX_MIME,
        bytes: buildMinimalDocx(["hello"]),
      }),
    ).toBe("docx")
    expect(
      validateAttachment({
        filename: "notes.txt",
        declaredMimeType: "text/plain",
        bytes: Buffer.from("hello"),
      }),
    ).toBe("text")
    expect(
      validateAttachment({
        filename: "notes.md",
        declaredMimeType: "text/markdown",
        bytes: Buffer.from("# hello"),
      }),
    ).toBe("text")
  })

  it("refuses a text file whose extension claims it is a PDF", () => {
    // The extension-lies case the magic-byte check exists for. The message
    // names what the bytes actually are, so the student knows what to fix.
    expect(() =>
      validateAttachment({
        filename: "notes.pdf",
        declaredMimeType: "application/pdf",
        bytes: Buffer.from("this is not a pdf"),
      }),
    ).toThrow(AttachmentUploadError)
    expect(() =>
      validateAttachment({
        filename: "notes.pdf",
        declaredMimeType: "application/pdf",
        bytes: Buffer.from("this is not a pdf"),
      }),
    ).toThrow(/are plain text, but the name is not a \.txt or \.md name/)
  })

  it("refuses a PDF whose extension claims it is a DOCX", () => {
    expect(() =>
      validateAttachment({
        filename: "essay.docx",
        declaredMimeType: DOCX_MIME,
        bytes: buildMinimalPdf("hello"),
      }),
    ).toThrow(/are a PDF, but the name is not a \.pdf name/)
  })

  it("refuses a PDF named .txt", () => {
    expect(() =>
      validateAttachment({
        filename: "essay.txt",
        declaredMimeType: "text/plain",
        bytes: buildMinimalPdf("hello"),
      }),
    ).toThrow(/are a PDF, but the name is not a \.pdf name/)
  })

  it("refuses a PDF declared as text/plain", () => {
    expect(() =>
      validateAttachment({
        filename: "essay.pdf",
        declaredMimeType: "text/plain",
        bytes: buildMinimalPdf("hello"),
      }),
    ).toThrow(/sent as "text\/plain"/)
  })

  it("treats application/octet-stream as unspecified and lets the bytes decide", () => {
    expect(
      validateAttachment({
        filename: "essay.pdf",
        declaredMimeType: "application/octet-stream",
        bytes: buildMinimalPdf("hello"),
      }),
    ).toBe("pdf")
  })

  it("refuses an empty file and one over the size cap", () => {
    expect(() =>
      validateAttachment({
        filename: "empty.txt",
        declaredMimeType: "text/plain",
        bytes: new Uint8Array(0),
      }),
    ).toThrow(/empty/)
    expect(() =>
      validateAttachment({
        filename: "huge.txt",
        declaredMimeType: "text/plain",
        bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      }),
    ).toThrow(/larger than/)
  })
})

describe("extractAttachment", () => {
  it("extracts DOCX paragraphs into sanitized HTML", async () => {
    const result = await extractAttachment({
      format: "docx",
      filename: "essay.docx",
      bytes: buildMinimalDocx(["Hello DOCX world", "Second paragraph"]),
    })

    expect(result.html).toBe("<p>Hello DOCX world</p><p>Second paragraph</p>")
    expect(result.wordCount).toBe(5)
    expect(result.textLength).toBeGreaterThan(0)
  })

  it("extracts PDF text into paragraphs", async () => {
    const result = await extractAttachment({
      format: "pdf",
      filename: "essay.pdf",
      bytes: buildMinimalPdf("Hello PDF upload world"),
    })

    expect(result.html).toContain("Hello PDF upload world")
    expect(result.wordCount).toBe(4)
  })

  it("extracts TXT and MD as paragraphs without rendering markdown", async () => {
    const result = await extractAttachment({
      format: "text",
      filename: "notes.md",
      bytes: Buffer.from("# Heading\n\nSome *body* text", "utf8"),
    })

    expect(result.html).toBe("<p># Heading</p><p>Some *body* text</p>")
    expect(result.wordCount).toBe(5)
  })

  it("escapes extracted text rather than interpreting it as markup", async () => {
    const result = await extractAttachment({
      format: "text",
      filename: "notes.txt",
      bytes: Buffer.from("5 < 10 <script>alert(1)</script>", "utf8"),
    })

    expect(result.html).not.toContain("<script>")
    expect(result.html).toContain("&lt;script&gt;")
  })

  it("fails readably when a PDF has no text layer", async () => {
    await expect(
      extractAttachment({
        format: "pdf",
        filename: "scan.pdf",
        bytes: buildMinimalPdf(""),
      }),
    ).rejects.toThrow(/scanned or image-only/)
  })

  it("fails readably when a DOCX cannot be parsed", async () => {
    await expect(
      extractAttachment({
        format: "docx",
        filename: "broken.docx",
        bytes: Buffer.from("PK\x03\x04not really a document"),
      }),
    ).rejects.toThrow(/could not read "broken\.docx" as a DOCX/)
  })
})
