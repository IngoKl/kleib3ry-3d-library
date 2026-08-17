/**
 * Spreads and pages, converted at the annotations-file boundary: the reader
 * thinks in spreads, and `annotations.json` speaks 1-based page numbers because
 * it is meant to be read without the app. Its own module, so it tests plainly.
 */

/**
 * The recto, which is the page the file records. Clamped when the count is
 * known; an EPUB's is not until it opens, and one page past the end still
 * converts back to the same spread.
 */
export const spreadToPage = (spread: number, pageCount: number | null): number =>
  pageCount === null ? 2 * spread + 1 : Math.min(2 * spread + 1, pageCount)

export const pageToSpread = (page: number): number => Math.floor(page / 2)
