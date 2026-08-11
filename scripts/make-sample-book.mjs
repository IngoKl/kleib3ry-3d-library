/**
 * Writes the one real PDF the browser driver can open.
 *
 * Without it the no-filesystem driver has no readable book at all, so read mode
 * — the page cache, the turn, the commit — is only ever exercised by
 * `test:desktop`, which needs a built installer and a real library folder. This
 * puts the whole reader inside `npm test`.
 *
 * Generated rather than committed, like the pdf.js cmaps beside it: the repo
 * stays text-only.
 *
 *   node scripts/make-sample-book.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROSE, makePdf } from './lib/make-pdf.mjs'

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
