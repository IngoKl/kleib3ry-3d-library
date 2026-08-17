import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { library } from '../services'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * PDF rasterisation for both the reader and cover extraction. The render is
 * cheap and the decode is what costs frames, so documents are opened once and
 * shared and pages rasterise one at a time.
 *
 * Reference-counted rather than cached forever: a parsed document pins its whole
 * file in the pdf.js worker, so keeping them during the cover sweep means the
 * library resident at once. Every `openDocument` needs its `closeDocument`.
 */

type OpenEntry = { doc: Promise<PDFDocumentProxy>; refs: number }
const documents = new Map<string, OpenEntry>()

/**
 * A hold on an open document, and the only way to let one go. Releasing is bound
 * to the entry rather than the book id, and is idempotent: a failed open drops
 * its entry, so an id-keyed release could arrive later and take somebody else's
 * reference — destroying the document the reader is still reading.
 */
export type Held = { doc: Promise<PDFDocumentProxy>; release: () => void }

export function openDocument(id: string): Held {
  const existing = documents.get(id)
  if (existing) {
    existing.refs += 1
    return { doc: existing.doc, release: releaser(id, existing) }
  }

  const entry: OpenEntry = {
    refs: 1,
    doc: (async () => {
      const bytes = await library.readBook(id)
      return pdfjs.getDocument({
        data: bytes,
        standardFontDataUrl: '/standard_fonts/',
        cMapUrl: '/cmaps/',
        cMapPacked: true,
      }).promise
    })(),
  }

  documents.set(id, entry)
  // A failed open must not be cached, or the book can never be retried.
  entry.doc.catch(() => {
    if (documents.get(id) === entry) documents.delete(id)
  })
  return { doc: entry.doc, release: releaser(id, entry) }
}

function releaser(id: string, entry: OpenEntry): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    entry.refs -= 1
    if (entry.refs > 0) return
    // Only if this entry is still the one under that id: a failed open has
    // already gone, and whatever is there now belongs to somebody else.
    if (documents.get(id) === entry) documents.delete(id)
    // Destroying the loading task, not `cleanup`: cleanup keeps the worker-side
    // document (and the file bytes) alive, which is the leak this exists to close.
    void entry.doc.then((doc) => doc.loadingTask.destroy()).catch(() => {})
  }
}

/** One page at a time: concurrent renders on one document thrash the worker. */
let queue: Promise<unknown> = Promise.resolve()
function serialise<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => {})
  return next
}

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetHeightPx: number,
  maxTextureSize = 8192,
): Promise<HTMLCanvasElement | null> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return null

  return serialise(async () => {
    const page = await doc.getPage(pageNumber)
    const unit = page.getViewport({ scale: 1 })
    const cap = Math.min(maxTextureSize / unit.height, maxTextureSize / unit.width)
    const scale = Math.max(0.1, Math.min(targetHeightPx / unit.height, cap))
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvas, canvasContext: context, viewport }).promise
    page.cleanup()
    return canvas
  })
}

export async function pageCount(id: string): Promise<number> {
  const held = openDocument(id)
  try {
    return (await held.doc).numPages
  } finally {
    held.release()
  }
}
