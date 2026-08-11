import type { IndexedBook } from '../services/types'

/**
 * Physical proportions for a book, derived from what the index actually knows.
 *
 * Page count drives thickness where we have it (PDFs); otherwise file size is a
 * rough stand-in. Height, depth and cloth colour come from a hash of the book's
 * id, so they are arbitrary but *stable*: a given book always looks the same and
 * you can learn to spot it on a shelf.
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

/** Sheets of paper are about 0.1 mm; a leaf is two pages, plus the boards. */
function thicknessFor(book: IndexedBook): number {
  if (book.pageCount && book.pageCount > 0) {
    return clamp(book.pageCount * 0.00005 + 0.006, 0.011, 0.075)
  }
  // EPUBs have no page count. Compressed size at least tracks length loosely.
  const megabytes = book.sizeBytes / (1024 * 1024)
  return clamp(0.012 + Math.sqrt(megabytes) * 0.012, 0.011, 0.06)
}

export function dimensionsFor(book: IndexedBook): BookDimensions {
  const hash = hashId(book.id)
  const a = ((hash >>> 0) % 1000) / 1000
  const b = ((hash >>> 10) % 1000) / 1000
  const c = ((hash >>> 20) % 1000) / 1000

  return {
    thickness: thicknessFor(book),
    // Hardbacks run taller than paperbacks; EPUBs get the paperback range.
    height: book.format === 'pdf' ? 0.2 + a * 0.075 : 0.185 + a * 0.045,
    depth: 0.118 + b * 0.038,
    colour: SPINE_COLOURS[hash % SPINE_COLOURS.length]!,
    lean: c > 0.94 ? (c - 0.97) * 2.6 : 0,
  }
}
