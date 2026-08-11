/**
 * A minimal, genuinely parseable PDF writer — raw syntax, no dependencies and
 * no binary fixtures in the repo.
 *
 * Shared by `make-test-library.mjs`, which builds the desktop corpus, and
 * `make-sample-book.mjs`, which builds the one readable book the browser
 * driver serves so the reader can be smoke tested headlessly.
 */

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

export function makePdf({ title, author, pages, body }) {
  const objects = []
  const put = (n, b) => {
    objects[n] = b
  }
  const pageObj = (i) => 6 + i * 2
  const contentObj = (i) => 7 + i * 2
  const kids = Array.from({ length: pages }, (_, i) => `${pageObj(i)} 0 R`).join(' ')

  put(1, '<< /Type /Catalog /Pages 2 0 R >>')
  put(2, `<< /Type /Pages /Count ${pages} /Kids [ ${kids} ] >>`)
  put(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  put(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  put(5, `<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (library3d test corpus) >>`)

  for (let i = 0; i < pages; i++) {
    const ops = [
      `BT /F2 22 Tf 72 720 Td (${esc(title)}) Tj ET`,
      `BT /F1 11 Tf 72 694 Td (${esc(author)}) Tj ET`,
      '0.6 g 72 684 m 540 684 l 0.7 w S 0 g',
      'BT /F1 10.5 Tf 14 TL 72 656 Td',
      ...body.map((line) => `(${esc(line)}) Tj T*`),
      'ET',
      // A discreet folio, as a real book has. No giant "PAGE 6" — this is meant
      // to look like a page you would read, not like a test fixture.
      `BT /F1 9 Tf 300 64 Td (${i + 1}) Tj ET`,
    ].join('\n')

    put(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
    )
    put(contentObj(i), `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`)
  }

  const chunks = []
  let offset = 0
  const push = (s) => {
    const b = Buffer.from(s, 'latin1')
    chunks.push(b)
    offset += b.length
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const xref = []
  for (let n = 1; n < objects.length; n++) {
    xref[n] = offset
    push(`${n} 0 obj\n${objects[n]}\nendobj\n`)
  }
  const startxref = offset
  push(`xref\n0 ${objects.length}\n0000000000 65535 f \n`)
  for (let n = 1; n < objects.length; n++) {
    push(`${String(xref[n]).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${startxref}\n%%EOF\n`)

  return Buffer.concat(chunks)
}

export const PROSE = [
  'A library is not a warehouse of finished thoughts but an instrument for producing',
  'new ones. The shelf is the argument: what stands beside what, which spine catches',
  'the eye on the way to somewhere else, which book has been pulled so often that it',
  'no longer sits flush with its neighbours. Cataloguing systems try to freeze this',
  'into an order, and every reader quietly subverts it.',
  '',
  'Consider the physical act of reading. The hand knows roughly how far in a passage',
  'sits before the eye confirms it. The thickness under the left thumb is a progress',
  'bar that no digital reader has convincingly replaced.',
]
