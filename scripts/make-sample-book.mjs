/**
 * The two real books the browser driver can open, one of each format. Without
 * them read mode is only exercised by `test:desktop`, which needs a built
 * installer and a real library folder; this puts the reader inside `npm test`.
 *
 * Generated rather than committed, like the pdf.js cmaps: the repo stays text.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROSE, makePdf } from './lib/make-pdf.mjs'
import { makeEpub } from './lib/make-epub.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'sample-book.pdf')

// Enough pages to turn several spreads forwards and back.
const pdf = makePdf({
  title: 'The Shelf as Argument',
  author: 'A. Sample',
  pages: 12,
  body: PROSE,
})

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, pdf)
console.log(`wrote ${out} (${pdf.length} bytes)`)

// And the same prose as an EPUB, long enough to set several pages of type.
const prose = PROSE.filter(Boolean)
const epub = makeEpub({
  title: 'The Shelf as Argument',
  author: 'A. Sample',
  chapters: Array.from({ length: 4 }, (_, i) => ({
    heading: `Chapter ${i + 1}`,
    // Repeated deliberately: the point of the fixture is that pagination has
    // enough text to break over several pages, not that it is worth reading.
    paragraphs: [...prose, ...prose, ...prose],
  })),
})

const epubOut = join(root, 'public', 'sample-book.epub')
writeFileSync(epubOut, epub)
console.log(`wrote ${epubOut} (${epub.length} bytes)`)
