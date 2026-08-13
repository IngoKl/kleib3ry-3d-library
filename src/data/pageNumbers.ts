/**
 * Spreads and pages, converted at the annotations-file boundary.
 *
 * The reader thinks in spreads — leaf s carries pages 2s and 2s+1 — but
 * `annotations.json` speaks 1-based page numbers, because it is meant to be
 * read without the app. Its own module, importable without the service layer,
 * so the arithmetic can be tested as plainly as it is stated.
 */

/**
 * The recto of a spread, which is the page the file records. Clamped when the
 * count is known; an EPUB's is not until it is opened, and one page past the
 * end still converts back to the same spread.
 */
export const spreadToPage = (spread: number, pageCount: number | null): number =>
  pageCount === null ? 2 * spread + 1 : Math.min(2 * spread + 1, pageCount)

export const pageToSpread = (page: number): number => Math.floor(page / 2)
