import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { library } from '../services'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * PDF rasterisation for both the reader and cover extraction.
 *
 * The spike established that the render itself is cheap and the *decode* is
 * what costs frames, so documents are opened once and cached, and pages are
 * rasterised one at a time rather than in parallel.
 */

const documents = new Map<string, Promise<PDFDocumentProxy>>()

export function openDocument(id: string): Promise<PDFDocumentProxy> {
  const existing = documents.get(id)
  if (existing) return existing

  const opening = (async () => {
    const bytes = await library.readBook(id)
    return pdfjs.getDocument({
      data: bytes,
      standardFontDataUrl: '/standard_fonts/',
      cMapUrl: '/cmaps/',
      cMapPacked: true,
    }).promise
  })()

  documents.set(id, opening)
  // A failed open must not be cached, or the book can never be retried.
  opening.catch(() => documents.delete(id))
  return opening
}

export function closeDocument(id: string) {
  const pending = documents.get(id)
  documents.delete(id)
  void pending?.then((doc) => doc.cleanup()).catch(() => {})
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
  return (await openDocument(id)).numPages
}
