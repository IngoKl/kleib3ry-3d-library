import { library } from '../services'
import type { IndexedBook } from '../services/types'
import { EpubError, parseEpub } from './epub'
import { PAGE_ASPECT, layOutEpub, renderEpubPage, type EpubLayout } from './epubPages'
import { openDocument, renderPage } from './pdf'

/**
 * What the reader reads: "a thing with pages you can rasterise" rather than
 * pdf.js's own shape. Two implementations, and nothing above this knows which it
 * has — which is why the drag, the turn, the bookmarks and `P` are identical.
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
  const held = openDocument(id)
  const doc = await held.doc
  const first = await doc.getPage(1)
  const view = first.getViewport({ scale: 1 })
  first.cleanup()

  return {
    pages: doc.numPages,
    aspect: view.width / view.height,
    render: (page, targetHeightPx, maxTextureSize) =>
      renderPage(doc, page, targetHeightPx, maxTextureSize),
    // The reader's cleanup and a cancelled open both reach here. `release` is
    // idempotent and drops this hold, not whatever is open under that id now.
    close: () => held.release(),
  }
}

async function epubSource(id: string): Promise<PageSource> {
  const bytes = await library.readBook(id)
  const book = await parseEpub(bytes)
  const layout: EpubLayout = layOutEpub(book)

  return {
    pages: layout.pages.length,
    aspect: PAGE_ASPECT,
    // Synchronous work behind a promise: setting a page is a millisecond, and
    // matching pdf.js's signature keeps the cache above from forking.
    render: async (page, targetHeightPx, maxTextureSize) =>
      renderEpubPage(layout, page, targetHeightPx, maxTextureSize),
    // Nothing is held open — the archive was read once and the layout is plain
    // objects — so there is nothing to give back.
    close: () => {},
  }
}

/**
 * Dispatches on the index's format rather than sniffing bytes: the index is what
 * shelved the book, and one that opens as something else is a worse surprise
 * than a failure.
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
 * One page rasterised on its own, for the two places that want one outside the
 * reader: a book lying open on a table, and a page pinned to a wall. Going
 * through the source keeps both format-blind.
 *
 * The source is shared while renders overlap and dropped when the last finishes:
 * a spread asks for two pages, and for an EPUB pagination is the expensive half.
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
