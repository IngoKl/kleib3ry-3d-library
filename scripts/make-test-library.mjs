/**
 * Generates a folder of real PDFs and EPUBs for end-to-end verification.
 *
 * Everything is written by hand — raw PDF syntax, a minimal store-only zip, a
 * hand-rolled PNG — so the test corpus needs no dependencies and no fixtures
 * checked into the repo. The files are genuinely parseable: the EPUBs carry
 * real OPF metadata and a real cover image, which is what exercises the Rust
 * probe rather than just proving the walker can see filenames.
 *
 *   node scripts/make-test-library.mjs [outputDir]
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PROSE, makePdf } from './lib/make-pdf.mjs'

const OUT = resolve(process.argv[2] ?? 'C:/tmp/kleib3ry-test-library')

// ---- PNG ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A plain two-tone cover, large enough to be obviously a real image. */
function makeCoverPng(width, height, [r, g, b], band) {
  const px = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inBand = y > height * band && y < height * (band + 0.14)
      px[i] = inBand ? 236 : r
      px[i + 1] = inBand ? 229 : g
      px[i + 2] = inBand ? 216 : b
      px[i + 3] = 255
    }
  }

  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    px.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ZIP (store only) --------------------------------------------------

function makeZip(entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)

    locals.push(local, nameBuf, data)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0, 10) // stored
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, end])
}

const utf8 = (s) => Buffer.from(s, 'utf8')

function makeEpub({ title, author, colour }) {
  const cover = makeCoverPng(360, 540, colour, 0.24)
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:${title.replace(/\W+/g, '-').toLowerCase()}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`

  return makeZip([
    // The spec wants `mimetype` first and uncompressed; store-only satisfies both.
    { name: 'mimetype', data: utf8('application/epub+zip') },
    {
      name: 'META-INF/container.xml',
      data: utf8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf"
    media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    },
    { name: 'OEBPS/content.opf', data: utf8(opf) },
    { name: 'OEBPS/images/cover.png', data: cover },
    {
      name: 'OEBPS/ch1.xhtml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>A generated chapter for testing.</p></body></html>`),
    },
  ])
}

// ---- corpus ------------------------------------------------------------


const PDFS = [
  { title: 'Notes on Cartography', author: 'H. Ueda', pages: 12 },
  { title: 'Against the Interior', author: 'C. Jelinek', pages: 24 },
  { title: 'The Book of Salt', author: 'L. Brennan', pages: 8 },
  { title: 'Letters to Clocks', author: 'M. Varga', pages: 40 },
  { title: 'On the Provinces', author: 'S. Okonkwo', pages: 16 },
]

const EPUBS = [
  { title: 'In Praise of Quiet', author: 'D. Lindqvist', colour: [125, 59, 50] },
  { title: 'The Death of Distance', author: 'R. Tanaka', colour: [47, 66, 87] },
  { title: 'Weather and Memory', author: 'B. Aldiss', colour: [63, 90, 74] },
]

/** Books live in `books/`; the rest of the folder is the library's other stuff. */
const BOOKS = join(OUT, 'books')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(BOOKS, 'essays'), { recursive: true })

for (const [i, spec] of PDFS.entries()) {
  const dir = i % 2 === 0 ? BOOKS : join(BOOKS, 'essays')
  const name = `${spec.title.toLowerCase().replace(/\W+/g, '_')}.pdf`
  writeFileSync(join(dir, name), makePdf({ ...spec, body: PROSE }))
}

for (const spec of EPUBS) {
  const name = `${spec.title.toLowerCase().replace(/\W+/g, '_')}.epub`
  writeFileSync(join(BOOKS, name), makeEpub(spec))
}

// Files the walker must ignore: not a book, in a skipped directory, or outside
// `books/` altogether — which is where the record player and the walls look.
writeFileSync(join(BOOKS, 'readme.txt'), 'not a book')
mkdirSync(join(BOOKS, 'node_modules'), { recursive: true })
writeFileSync(join(BOOKS, 'node_modules', 'ignored.pdf'), makePdf({ ...PDFS[0], body: PROSE }))
mkdirSync(join(OUT, 'music'), { recursive: true })
writeFileSync(join(OUT, 'music', 'sleeve_notes.pdf'), makePdf({ ...PDFS[0], body: PROSE }))

console.log(`wrote ${PDFS.length} PDFs and ${EPUBS.length} EPUBs to ${BOOKS}`)
