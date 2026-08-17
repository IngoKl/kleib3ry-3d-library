/**
 * A minimal but genuinely parseable EPUB writer — raw zip syntax, no
 * dependencies, no binary fixtures. Counterpart to `make-pdf.mjs`: without one
 * real file of each format, only `test:desktop` exercises the reader.
 *
 * Both compression methods appear on purpose, so opening the sample exercises
 * `zip.ts`'s stored branch and its `DecompressionStream` one.
 */
import { deflateRawSync } from 'node:zlib'

const encoder = new TextEncoder()
/** Entries left uncompressed. See the note above. */
const STORED = new Set(['mimetype', 'META-INF/container.xml'])

/** CRC-32, table built once. The one piece of arithmetic a zip actually needs. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * `mimetype` must be first and uncompressed — the one thing the EPUB spec says
 * about the container, worth honouring even though nothing here would notice.
 */
function zip(files) {
  const chunks = []
  const central = []
  let offset = 0

  const u16 = (value) => {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setUint16(0, value, true)
    return b
  }
  const u32 = (value) => {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, value >>> 0, true)
    return b
  }

  for (const [name, text] of files) {
    const nameBytes = encoder.encode(name)
    const data = typeof text === 'string' ? encoder.encode(text) : text
    const sum = crc32(data)
    // The CRC and the *uncompressed* size describe the original bytes; only the
    // compressed size and the method describe what is actually in the file.
    const stored = STORED.has(name)
    const body = stored ? data : new Uint8Array(deflateRawSync(data))
    const method = stored ? 0 : 8

    const local = [
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(method),
      u16(0), // time
      u16(0), // date
      u32(sum),
      u32(body.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      body,
    ]
    central.push([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(sum),
      u32(body.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ])

    for (const part of local) {
      chunks.push(part)
      offset += part.length
    }
  }

  const directoryOffset = offset
  let directorySize = 0
  for (const entry of central) {
    for (const part of entry) {
      chunks.push(part)
      directorySize += part.length
    }
  }

  for (const part of [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(directorySize),
    u32(directoryOffset),
    u16(0),
  ]) {
    chunks.push(part)
  }

  const total = chunks.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of chunks) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const escapeXml = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Each chapter becomes one document in the spine, which is what makes it a
 * chapter: the reader starts a fresh page at each one.
 */
export function makeEpub({ title, author, chapters }) {
  const files = [['mimetype', 'application/epub+zip']]

  files.push([
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  ])

  chapters.forEach((chapter, i) => {
    const body = chapter.paragraphs.map((p) => `    <p>${escapeXml(p)}</p>`).join('\n')
    files.push([
      `OEBPS/chapter${i + 1}.xhtml`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>${escapeXml(chapter.heading)}</title></head>
  <body>
    <h1>${escapeXml(chapter.heading)}</h1>
${body}
  </body>
</html>`,
    ])
  })

  const manifest = chapters
    .map(
      (_, i) =>
        `    <item id="c${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('\n')
  const spine = chapters.map((_, i) => `    <itemref idref="c${i + 1}"/>`).join('\n')

  files.push([
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">kleib3ry-sample</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`,
  ])

  return zip(files)
}
