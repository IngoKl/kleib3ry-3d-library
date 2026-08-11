// Generates a deliberately text-heavy PDF used as the worst case for the
// legibility spike: dense 9.5pt body copy, a point-size ladder, and hairline
// rules that expose mipmap/aniso aliasing. No dependencies -- raw PDF bytes.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf')
const PAGES = 16
const W = 612 // US Letter, points
const H = 792

const PARAGRAPHS = [
  'A library is not a warehouse of finished thoughts but an instrument for producing new ones. The shelf is the argument: what stands beside what, which spine catches the eye on the way to somewhere else, which book has been pulled so often that it no longer sits flush with its neighbours. Cataloguing systems try to freeze this into an order, and every reader quietly subverts it.',
  'Consider the physical act of reading. The hand knows roughly how far in a passage sits before the eye confirms it. The thickness under the left thumb is a progress bar that no digital reader has convincingly replaced, and the slight resistance of a page turning is feedback that the text has moved on without you having to look for a page number.',
  'The typography of a page is a set of promises about how long you will be here. Wide margins say the publisher expects marginalia. Tight leading says the text is dense and you should slow down. A running head says you will lose your place and will need help finding it again. None of this survives a naive translation into a scrolling column of reflowed HTML.',
  'What a rendering engine must preserve, then, is not merely the glyphs but their spatial relation: the gutter, the measure, the position of a footnote relative to the sentence that summoned it. Rasterising the page and treating it as an image is crude, but it is honest about what it is preserving, and it fails in visible rather than invisible ways.',
  'Distance is the enemy of legibility. Text that is perfectly crisp at three hundred dots per inch on paper becomes a grey smear at twelve pixels of screen height per line, and no amount of texture resolution will recover it, because the limit is the display, not the source. The only real lever is to bring the page closer or make it larger.',
  'Anisotropic filtering matters here more than raw resolution. A page held at an angle presents a strongly foreshortened surface, and isotropic mipmapping will select a level appropriate to the compressed axis, blurring the axis that is still well sampled. Turning anisotropy up to the hardware maximum is nearly free and recovers most of the apparent sharpness.',
  'Curvature near the spine is where the illusion is won or lost. A perfectly flat page reads as a poster. A page that bows into the gutter, catching light along the fold and compressing the innermost characters slightly, reads as paper. The compression must stay small: a few degrees of tangent deviation is enough to be felt and not enough to be resented.',
  'None of this is settled by argument. Build the smallest possible thing that puts real type on a real curved surface at a real reading distance, then look at it. If the text can be read without leaning in, the idea survives. If it cannot, no amount of architecture downstream will rescue it, and the honest move is to flatten the page and keep the room.',
]

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

/** Greedy wrap by estimated Helvetica width (avg advance ~0.5 em is close enough). */
function wrap(text, fontSize, maxWidth) {
  const perChar = fontSize * 0.5
  const max = Math.floor(maxWidth / perChar)
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > max) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

function contentStream(pageNo) {
  const marginX = 72
  const measure = W - marginX * 2
  const body = []
  // Cycle paragraphs so consecutive pages differ, and repeat enough to fill.
  for (let i = 0; i < 4; i++) {
    const p = PARAGRAPHS[(pageNo * 3 + i) % PARAGRAPHS.length]
    body.push(...wrap(p, 9.5, measure), '')
  }

  const ops = []
  // Running head + rule
  ops.push('BT /F2 8 Tf 72 752 Td (THE THREE-DIMENSIONAL PERSONAL LIBRARY) Tj ET')
  ops.push('0.6 g 72 746 m 540 746 l 0.4 w S 0 g')
  // Chapter title
  ops.push(`BT /F2 17 Tf 72 716 Td (${esc(`Chapter ${pageNo}. On Shelves and Their Discontents`)}) Tj ET`)
  // Body copy at 9.5pt / 13pt leading
  ops.push('BT /F1 9.5 Tf 13 TL 72 692 Td')
  for (const line of body.slice(0, 34)) ops.push(`(${esc(line)}) Tj T*`)
  ops.push('ET')

  // Point-size ladder -- the actual legibility ruler.
  let y = 232
  ops.push('BT /F2 9 Tf 72 246 Td (LEGIBILITY LADDER) Tj ET')
  for (const pt of [6, 7, 8, 9, 10, 11, 12]) {
    ops.push(
      `BT /F1 ${pt} Tf 72 ${y} Td (${pt}pt  The quick brown fox jumps over the lazy dog 0123456789 ` +
        `-- page ${pageNo}) Tj ET`,
    )
    y -= pt + 5
  }

  // Hairline rules at decreasing weights -- aliasing / moire probe.
  y -= 12
  ops.push('BT /F2 9 Tf 72 ' + (y + 12) + ' Td (HAIRLINE RULES 1.0 / 0.5 / 0.25 pt) Tj ET')
  for (const w of [1.0, 0.5, 0.25]) {
    for (let i = 0; i < 6; i++) {
      ops.push(`0 g 72 ${y - i * 2} m 540 ${y - i * 2} l ${w} w S`)
    }
    y -= 20
  }

  // Big page marker so a page turn is unmistakable in a screenshot.
  ops.push(`BT /F2 40 Tf 72 60 Td (PAGE ${pageNo}) Tj ET`)
  ops.push(`BT /F1 8 Tf 460 62 Td (folio ${pageNo} of ${PAGES}) Tj ET`)

  return ops.join('\n')
}

// ---- assemble ----------------------------------------------------------
const objects = [] // objects[n] holds the body of object n (1-indexed)
const put = (n, body) => {
  objects[n] = body
}

const pageObjNum = (i) => 5 + i * 2
const contentObjNum = (i) => 6 + i * 2
const kids = Array.from({ length: PAGES }, (_, i) => `${pageObjNum(i)} 0 R`).join(' ')

put(1, '<< /Type /Catalog /Pages 2 0 R >>')
put(2, `<< /Type /Pages /Count ${PAGES} /Kids [ ${kids} ] >>`)
put(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
put(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

for (let i = 0; i < PAGES; i++) {
  const stream = contentStream(i + 1)
  put(
    pageObjNum(i),
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`,
  )
  put(
    contentObjNum(i),
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  )
}

const chunks = []
let offset = 0
const push = (s) => {
  const b = Buffer.from(s, 'latin1')
  chunks.push(b)
  offset += b.length
}

push('%PDF-1.4\n')
push('%\xE2\xE3\xCF\xD3\n')

const xref = []
for (let n = 1; n < objects.length; n++) {
  xref[n] = offset
  push(`${n} 0 obj\n${objects[n]}\nendobj\n`)
}

const startxref = offset
const count = objects.length // n objects + the free entry at index 0
push(`xref\n0 ${count}\n`)
push('0000000000 65535 f \n')
for (let n = 1; n < objects.length; n++) {
  push(`${String(xref[n]).padStart(10, '0')} 00000 n \n`)
}
push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat(chunks))
console.log(`wrote ${OUT} (${PAGES} pages, ${Buffer.concat(chunks).length} bytes)`)
