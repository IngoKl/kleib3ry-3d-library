import type { IndexedBook } from '../services/types'

/**
 * Physical proportions for a book, derived from what the index actually knows.
 *
 * Page count drives thickness — that is the point of it: a shelf should tell
 * you at a glance which books are the long ones. Height, depth and cloth colour
 * come from a hash of the book's id, so they are arbitrary but *stable*: a given
 * book always looks the same and you can learn to spot it on a shelf.
 *
 * Everything here is deliberately larger than life. A spine is read from across
 * a room, and at true scale the printed title lands on a handful of screen
 * pixels no matter how much texture is thrown at it — the only thing that buys
 * legibility is size, so the books are about a quarter over life size and the
 * bookcases in `shelf.ts` were grown to match.
 */
export type BookDimensions = {
  thickness: number
  height: number
  depth: number
  colour: string
  lean: number
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
 * EPUBs carry no page count, so the only signal is compressed size — and a
 * pamphlet and a doorstop really are different sizes on disk. The curve is
 * square-rooted because most of an EPUB's bulk after the first megabyte is
 * images rather than text.
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
  const c = ((hash >>> 20) % 1000) / 1000

  return {
    thickness: thicknessFor(book),
    // Hardbacks run taller than paperbacks; EPUBs get the paperback range.
    height: book.format === 'pdf' ? 0.255 + a * 0.085 : 0.235 + a * 0.05,
    depth: 0.15 + b * 0.046,
    colour: SPINE_COLOURS[hash % SPINE_COLOURS.length]!,
    lean: c > 0.94 ? (c - 0.97) * 2.6 : 0,
  }
}
