import { library } from '../services'
import type { IndexedBook } from '../services/types'
import { EpubError, parseEpub } from './epub'
import { PAGE_ASPECT, layOutEpub, renderEpubPage, type EpubLayout } from './epubPages'
import { closeDocument, openDocument, renderPage } from './pdf'

/**
 * What the reader actually reads.
 *
 * The reader used to hold a `PDFDocumentProxy` directly, which is why EPUBs
 * were books you could shelve and not open: everything downstream of opening —
 * the page cache, the turn, the dock, the bookmarks — was written against
 * pdf.js's shape rather than against "a thing with pages you can rasterise".
 *
 * This is that shape. Two implementations: pdf.js for a PDF, and the type
 * setter in `epubPages.ts` for an EPUB. Everything above it is unchanged and
 * does not know which it has, which is why the whole of read mode — dragging a
 * leaf across, tearing a page out to pin up, going to page 340 — works
 * identically for both.
 */
export type PageSource = {
  pages: number
  /** Width over height of a single page, for the dock to frame the spread. */
  aspect: number
  render(
    page: number,
    targetHeightPx: number,
    maxTextureSize: number,
  ): Promise<HTMLCanvasElement | null>
  /** Every `openSource` must be paired with one of these. */
  close(): void
}

async function pdfSource(id: string): Promise<PageSource> {
  const doc = await openDocument(id)
  let closed = false
  const first = await doc.getPage(1)
  const view = first.getViewport({ scale: 1 })
  first.cleanup()

  return {
    pages: doc.numPages,
    aspect: view.width / view.height,
    render: (page, targetHeightPx, maxTextureSize) =>
      renderPage(doc, page, targetHeightPx, maxTextureSize),
    close: () => {
      // Guarded because the reader's cleanup and a cancelled open can both
      // reach here, and the document is reference counted.
      if (closed) return
      closed = true
      closeDocument(id)
    },
  }
}

async function epubSource(id: string): Promise<PageSource> {
  const bytes = await library.readBook(id)
  const book = await parseEpub(bytes)
  const layout: EpubLayout = layOutEpub(book)

  return {
    pages: layout.pages.length,
    aspect: PAGE_ASPECT,
    // Synchronous work behind a promise, deliberately: setting a page of type is
    // a millisecond, and matching pdf.js's signature is what keeps the cache
    // above this from having two paths through it.
    render: async (page, targetHeightPx, maxTextureSize) =>
      renderEpubPage(layout, page, targetHeightPx, maxTextureSize),
    // Nothing is held open — the archive was read once and the layout is plain
    // objects — so there is nothing to give back.
    close: () => {},
  }
}

/**
 * Open a book for reading.
 *
 * Dispatches on the *index's* format rather than sniffing the bytes, because the
 * index is what put the book on the shelf and a book that is shelved as one
 * thing and opens as another is a worse surprise than a failure.
 */
export async function openSource(book: IndexedBook): Promise<PageSource> {
  if (book.format === 'epub') {
    try {
      return await epubSource(book.id)
    } catch (e) {
      // `EpubError` messages are written to be read by whoever owns the file;
      // anything else gets a sentence rather than a stack.
      throw e instanceof EpubError
        ? e
        : new Error(e instanceof Error ? e.message : 'this EPUB could not be opened')
    }
  }
  return pdfSource(book.id)
}

/**
 * One page of one book, rasterised on its own.
 *
 * For the two places that want a page *outside* the reader: a book left lying
 * open on a table, and a page torn out and pinned to a wall. Going through the
 * source keeps both format-blind, like everything else above this file.
 *
 * The source is shared while renders overlap and dropped the moment the last
 * one finishes: an open spread asks for two pages at once, and for an EPUB the
 * pagination — not the drawing — is the expensive half.
 */
const shared = new Map<string, { source: Promise<PageSource>; refs: number }>()

export async function renderOnePage(
  book: IndexedBook,
  page: number,
  heightPx: number,
): Promise<HTMLCanvasElement | null> {
  const existing = shared.get(book.id)
  const entry = existing ?? { source: openSource(book), refs: 0 }
  entry.refs += 1
  if (!existing) shared.set(book.id, entry)

  try {
    const source = await entry.source
    return await source.render(page, heightPx, 8192)
  } finally {
    entry.refs -= 1
    if (entry.refs === 0) {
      shared.delete(book.id)
      void entry.source.then((source) => source.close()).catch(() => {})
    }
  }
}
