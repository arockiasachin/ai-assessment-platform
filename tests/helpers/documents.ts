/**
 * Tiny, dependency-free document fixtures.
 *
 * The upload tests need a real DOCX and a real PDF to prove the extraction path;
 * committing binaries would be opaque and fragile, so they are built here from
 * the formats' own structure:
 *
 * - a DOCX is a ZIP containing `[Content_Types].xml`, `_rels/.rels` and
 *   `word/document.xml`. The ZIP writer below uses the uncompressed `STORE`
 *   method, so only a CRC-32 implementation is needed on top of Node's `Buffer`.
 * - a PDF is a plain-text file with a cross-reference table. Byte offsets are
 *   computed as the file is assembled, which is what a PDF reader uses to find
 *   each object.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build an uncompressed (STORE) ZIP archive from UTF-8 text entries. */
function buildZip(entries: Array<[string, string]>): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, "utf8")
    const data = Buffer.from(content, "utf8")
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // STORE
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, nameBuffer, data)

    const directoryEntry = Buffer.alloc(46)
    directoryEntry.writeUInt32LE(0x02014b50, 0)
    directoryEntry.writeUInt16LE(20, 4)
    directoryEntry.writeUInt16LE(20, 6)
    directoryEntry.writeUInt32LE(crc, 16)
    directoryEntry.writeUInt32LE(data.length, 20)
    directoryEntry.writeUInt32LE(data.length, 24)
    directoryEntry.writeUInt16LE(nameBuffer.length, 28)
    directoryEntry.writeUInt32LE(offset, 42)
    central.push(directoryEntry, nameBuffer)

    offset += local.length + nameBuffer.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, centralBuffer, end])
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`

/**
 * A minimal, valid DOCX whose single paragraph is `paragraphs` joined by
 * paragraph breaks.
 */
export function buildMinimalDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join("")
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  return buildZip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", RELATIONSHIPS],
    ["word/document.xml", document],
  ])
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * A minimal, valid single-page PDF drawing `text` in Helvetica, with a computed
 * cross-reference table.
 */
export function buildMinimalPdf(text: string): Buffer {
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    5: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  }
  const stream = `BT /F1 24 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`
  objects[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`

  let output = "%PDF-1.4\n"
  const offsets: number[] = []
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = Buffer.byteLength(output)
    output += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefOffset = Buffer.byteLength(output)
  output += "xref\n0 6\n0000000000 65535 f \n"
  for (let i = 1; i <= 5; i += 1) {
    output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(output, "binary")
}
