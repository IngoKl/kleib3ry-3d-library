import type { IndexedBook } from '../services/types'

/**
 * Physical proportions for a book, derived from index data alone.
 *
 * Page count drives thickness, so a shelf shows at a glance which books are the
 * long ones. Height, depth and cloth colour come from a hash of the book id:
 * arbitrary but *stable*, so a book always looks the same.
 *
 * Everything is about a quarter over life size, and `world/shelf.ts` matches.
 * At true scale a printed spine lands on a handful of screen pixels however
 * much texture is thrown at it; only size buys legibility.
 */
export type BookDimensions = {
  thickness: number
  height: number
  depth: number
  colour: string
}

const SPINE_COLOURS = [
  '#7d3b32', '#8c5a2b', '#3f5a4a', '#2f4257', '#6b2f3c', '#4a4038',
  '#7a6a44', '#2e4a3f', '#5a3a55', '#8a7350', '#334a52', '#6e4630',
  '#43506b', '#775241', '#3d3a44', '#5d6b4a', '#8d6b52', '#2b3a45',
]

/** FNV-1a. Small, stable, and good enough to scatter ids across a palette. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Metres of spine per page, at the scale the room is drawn at. */
const PER_PAGE = 0.000082
const MIN_THICKNESS = 0.013
const MAX_THICKNESS = 0.098

/**
 * How many pages a file that does not say is likely to have.
 *
 * Rarely reached now: a PDF states its page count and the EPUB probe measures
 * the length of the documents inside the archive, which is a far better signal
 * than the size of the file around them. This is for the ones that answer
 * neither — an archive with nothing document-shaped in it, or a row indexed
 * before the probe learned to measure. The curve is square-rooted because most
 * of a book's bulk on disk after the first megabyte is images rather than text.
 */
export function estimatedPages(book: IndexedBook): number {
  if (book.pageCount && book.pageCount > 0) return book.pageCount
  const megabytes = Math.max(0.02, book.sizeBytes / (1024 * 1024))
  return Math.round(clamp(90 * Math.sqrt(megabytes) + 30, 24, 1400))
}

/**
 * Sheets of paper are about 0.1 mm; a leaf is two pages, plus the boards. The
 * clamp is what keeps a 4,000-page reference work from being wider than the
 * compartment it has to stand in.
 */
export function thicknessFor(book: IndexedBook): number {
  return clamp(estimatedPages(book) * PER_PAGE + 0.008, MIN_THICKNESS, MAX_THICKNESS)
}

export function dimensionsFor(book: IndexedBook): BookDimensions {
  const hash = hashId(book.id)
  const a = ((hash >>> 0) % 1000) / 1000
  const b = ((hash >>> 10) % 1000) / 1000

  // No lean here: a book wedged between two others stands plumb, whatever its
  // own character, and the only books with room to lean are the ones at the
  // open end of a row. `packRow` settles those — see `shelving.ts`.
  return {
    thickness: thicknessFor(book),
    // Hardbacks run taller than paperbacks; EPUBs get the paperback range.
    height: book.format === 'pdf' ? 0.255 + a * 0.085 : 0.235 + a * 0.05,
    depth: 0.15 + b * 0.046,
    colour: SPINE_COLOURS[hash % SPINE_COLOURS.length]!,
  }
}
