// pdf.js needs the standard-14 font data (Helvetica, Times, ...) and cmaps at
// runtime for any PDF that does not embed its fonts. Copy them into public/.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const from = resolve(root, 'node_modules/pdfjs-dist')
const to = resolve(root, 'public')

mkdirSync(to, { recursive: true })
for (const dir of ['standard_fonts', 'cmaps']) {
  cpSync(resolve(from, dir), resolve(to, dir), { recursive: true })
  console.log(`copied ${dir}/`)
}
