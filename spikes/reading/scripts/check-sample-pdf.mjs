// Sanity-check that the generated PDF actually parses and has extractable text.
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const file = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample.pdf')
const data = new Uint8Array(readFileSync(file))
const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise
console.log('numPages:', doc.numPages)
const page = await doc.getPage(1)
const { width, height } = page.getViewport({ scale: 1 })
console.log('page 1 size:', width, 'x', height)
const text = await page.getTextContent()
const joined = text.items.map((i) => i.str).join(' ')
console.log('text items:', text.items.length)
console.log('excerpt:', joined.slice(0, 160))
const last = await doc.getPage(doc.numPages)
const lastText = (await last.getTextContent()).items.map((i) => i.str).join(' ')
console.log('last page marker:', /PAGE \d+/.exec(lastText)?.[0])
