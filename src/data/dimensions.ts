import type { IndexedBook } from '../services/types'

/**
 * Physical proportions from index data alone. Page count drives thickness, so a
 * shelf shows at a glance which books are the long ones; height, depth and cloth
 * come from a hash of the id — arbitrary but stable. Everything is a quarter
 * over life size, because at true scale a printed spine is a handful of pixels
 * however much texture is thrown at it.
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
 * How many pages a file that does not say is likely to have. Rarely reached: a
 * PDF states its count and the EPUB probe measures the documents inside. Square
 * rooted, because most of a book's bulk after the first megabyte is images.
 */
export function estimatedPages(book: IndexedBook): number {
  if (book.pageCount && book.pageCount > 0) return book.pageCount
  const megabytes = Math.max(0.02, book.sizeBytes / (1024 * 1024))
  return Math.round(clamp(90 * Math.sqrt(megabytes) + 30, 24, 1400))
}

/**
 * Paper is about 0.1 mm and a leaf is two pages, plus boards. The clamp keeps a
 * 4,000-page reference work narrower than the compartment it stands in.
 */
export function thicknessFor(book: IndexedBook): number {
  return clamp(estimatedPages(book) * PER_PAGE + 0.008, MIN_THICKNESS, MAX_THICKNESS)
}

export function dimensionsFor(book: IndexedBook): BookDimensions {
  const hash = hashId(book.id)
  const a = ((hash >>> 0) % 1000) / 1000
  const b = ((hash >>> 10) % 1000) / 1000

  // No lean here: a book wedged between two others stands plumb, and only the
  // ones at the open end of a row have room. `packRow` settles those.
  return {
    thickness: thicknessFor(book),
    // Hardbacks run taller than paperbacks; EPUBs get the paperback range.
    height: book.format === 'pdf' ? 0.255 + a * 0.085 : 0.235 + a * 0.05,
    depth: 0.15 + b * 0.046,
    colour: SPINE_COLOURS[hash % SPINE_COLOURS.length]!,
  }
}
