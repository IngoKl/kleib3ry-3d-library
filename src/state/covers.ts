import { library } from '../services'
import type { IndexedBook } from '../services/types'
import { openDocument, renderPage } from '../reader/pdf'

/**
 * Cover images, fetched or rendered on demand.
 *
 * EPUB covers come out of the file during indexing, so those are just a path.
 * PDFs need a renderer: rather than ship pdfium alongside the app, the first
 * page is rasterised here with pdf.js — already loaded for reading — and handed
 * back to Rust to cache, so it happens once per book, ever.
 *
 * Rendering is lazy and only for books you actually pick up. Rasterising a
 * thousand first pages at scan time would take minutes and most would never be
 * looked at.
 */

const COVER_HEIGHT_PX = 700

const resolved = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

export function peekCover(id: string): string | null | undefined {
  return resolved.get(id)
}

export function coverFor(book: IndexedBook): Promise<string | null> {
  const cached = resolved.get(book.id)
  if (cached !== undefined) return Promise.resolve(cached)

  const inflight = pending.get(book.id)
  if (inflight) return inflight

  const job = (async (): Promise<string | null> => {
    if (book.cover) return library.assetUrl(book.cover)
    if (book.format !== 'pdf') return null

    try {
      const doc = await openDocument(book.id)
      const canvas = await renderPage(doc, 1, COVER_HEIGHT_PX)
      if (!canvas) return null

      const dataUrl = canvas.toDataURL('image/png')
      // Persist so the next launch reads it off disk instead of re-rendering.
      const saved = await library.saveRenderedCover(book.id, dataUrl).catch(() => null)
      return saved ? library.assetUrl(saved) : dataUrl
    } catch {
      return null
    }
  })()

  pending.set(book.id, job)
  void job.then((url) => {
    resolved.set(book.id, url)
    pending.delete(book.id)
  })
  return job
}

/**
 * The colour a book's binding should be, taken from its cover.
 *
 * Spine colours used to come from a hash of the id — stable, and completely
 * unrelated to the book. Sampling the artwork instead means a shelf of your
 * books looks like *your* books from across the room, before any of the type is
 * legible.
 *
 * Pale and near-black pixels are skipped: most covers are largely paper or
 * margin, and averaging those gives every book the same dirty grey.
 */
const colours = new Map<string, string | null>()
const colourJobs = new Map<string, Promise<string | null>>()

export function peekCoverColour(id: string): string | null | undefined {
  return colours.get(id)
}

function sample(image: HTMLImageElement): string | null {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, size, size)

  let r = 0
  let g = 0
  let b = 0
  let counted = 0
  const { data } = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i]!
    const pg = data[i + 1]!
    const pb = data[i + 2]!
    const luminance = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255
    if (luminance > 0.86 || luminance < 0.06) continue
    r += pr
    g += pg
    b += pb
    counted += 1
  }
  // An all-white scan or an all-black one leaves nothing to go on.
  if (counted < 24) return null

  // Bindings are deeper and more saturated than the artwork they carry, or the
  // shelf turns into a row of pastels.
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v / counted) * 0.78)))
  return `#${[to(r), to(g), to(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function coverColourFor(book: IndexedBook): Promise<string | null> {
  const known = colours.get(book.id)
  if (known !== undefined) return Promise.resolve(known)
  const running = colourJobs.get(book.id)
  if (running) return running

  const job = (async (): Promise<string | null> => {
    const url = await coverFor(book)
    if (!url) return null
    return await new Promise<string | null>((resolve) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(sample(image))
      image.onerror = () => resolve(null)
      image.src = url
    })
  })()

  colourJobs.set(book.id, job)
  void job.then((colour) => {
    colours.set(book.id, colour)
    colourJobs.delete(book.id)
  })
  return job
}

/**
 * Cover artwork as a decoded image, ready to be drawn into the book atlas.
 *
 * Rate-limited hard, because for a PDF "fetch the cover" means rasterising its
 * first page: a shelf of a hundred books would otherwise queue a hundred
 * renders the moment you walked up to it. Two at a time fills a shelf in over a
 * few seconds without ever competing with the frame you are looking at, and the
 * results are cached to disk, so it happens once per book ever.
 */
const images = new Map<string, HTMLImageElement | null>()
const imageQueue: IndexedBook[] = []
let inFlight = 0
const MAX_IN_FLIGHT = 2

export function peekCoverImage(id: string): HTMLImageElement | null | undefined {
  return images.get(id)
}

/** Called when a cover finishes, so whoever drew the book can redraw it. */
export const onCoverReady = new Set<(id: string) => void>()

function pump() {
  while (inFlight < MAX_IN_FLIGHT && imageQueue.length > 0) {
    const book = imageQueue.shift()!
    inFlight += 1
    void (async () => {
      let image: HTMLImageElement | null = null
      try {
        const url = await coverFor(book)
        if (url) {
          image = await new Promise<HTMLImageElement | null>((resolve) => {
            const element = new Image()
            element.crossOrigin = 'anonymous'
            element.onload = () => resolve(element)
            element.onerror = () => resolve(null)
            element.src = url
          })
        }
      } catch {
        image = null
      }
      images.set(book.id, image)
      if (image) colours.set(book.id, sample(image))
      inFlight -= 1
      for (const listener of onCoverReady) listener(book.id)
      pump()
    })()
  }
}

/** Queue a book's cover. Safe to call every frame; it only ever queues once. */
export function coverImageFor(book: IndexedBook) {
  if (images.has(book.id)) return
  if (imageQueue.some((queued) => queued.id === book.id)) return
  images.set(book.id, null) // claim it, so it is not queued twice
  images.delete(book.id)
  imageQueue.push(book)
  pump()
}
