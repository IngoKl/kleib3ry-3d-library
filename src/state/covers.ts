import { library } from '../services'
import type { IndexedBook } from '../services/types'
import { openDocument, renderPage } from '../reader/pdf'

/**
 * Cover images, fetched or rendered on demand. An EPUB's comes out during
 * indexing, so it is just a path; a PDF's is rasterised here with pdf.js —
 * already loaded for reading — rather than shipping pdfium, and handed to Rust
 * to cache, so it happens once per book ever.
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
      const held = openDocument(book.id)
      try {
        const canvas = await renderPage(await held.doc, 1, COVER_HEIGHT_PX)
        if (!canvas) return null

        const dataUrl = canvas.toDataURL('image/png')
        // Persist so the next launch reads it off disk instead of re-rendering.
        const saved = await library.saveRenderedCover(book.id, dataUrl).catch(() => null)
        return saved ? library.assetUrl(saved) : dataUrl
      } finally {
        // Released the moment the cover is out: the warm sweep walks the whole
        // catalogue, and holding each parsed PDF would pin the library in the
        // worker. This hold and nobody else's, or it closes an open book.
        held.release()
      }
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
 * A binding's colour, sampled from its cover, so a shelf reads as your books
 * before any type is legible; falls back to the id hash. Pale and near-black
 * pixels are skipped, or the margins give every book the same dirty grey.
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
 * Cover artwork decoded and ready for the atlas. Rate-limited hard, because for
 * a PDF this means rasterising a page: two at a time fills a shelf over a few
 * seconds without competing with the frame you are looking at.
 */
const images = new Map<string, HTMLImageElement | null>()
/** Books asked for by name — a shelf you are standing at, a book in your hand. */
const urgent: IndexedBook[] = []
/** The rest of the library, warmed in the background. */
const background: IndexedBook[] = []
/** Claimed the moment a book is queued, so nothing is ever fetched twice. */
const claimed = new Set<string>()

/**
 * How many decoded covers to keep: `warmCovers` walks the whole catalogue, so
 * without a cap a large library ends its sweep holding every cover it drew.
 *
 * `images` iterates in insertion order and `peekCoverImage` re-inserts on a hit,
 * so the front of the map is the least recently drawn — which makes eviction
 * "whatever is furthest from where you are standing".
 */
const MAX_CACHED = 600

/**
 * Drop a book's decoded artwork and its claim. What it keeps is the point: a
 * path and a colour are a few dozen bytes, so walking back to a shelf is a
 * decode rather than another rasterisation. A data URL is the whole PNG, so
 * that one goes with the image it belongs to.
 */
function forget(id: string) {
  images.delete(id)
  claimed.delete(id)
  if (resolved.get(id)?.startsWith('data:')) resolved.delete(id)
}

/** Record a decoded cover, evicting the least recently drawn to stay under the cap. */
function remember(id: string, image: HTMLImageElement | null) {
  images.set(id, image)
  while (images.size > MAX_CACHED) {
    const oldest = images.keys().next().value
    if (oldest === undefined || oldest === id) break
    forget(oldest)
  }
}

/**
 * Called when the library folder changes. Ids are content hashes, so keeping the
 * last library's covers would not be wrong — only megabytes about absent books.
 */
export function forgetCovers() {
  images.clear()
  resolved.clear()
  colours.clear()
  claimed.clear()
  pending.clear()
  colourJobs.clear()
  urgent.length = 0
  background.length = 0
}

let inFlight = 0
const MAX_IN_FLIGHT = 2
/**
 * The urgent queue runs flat out because you are looking at those books; the
 * background one walks the whole library, so it leaves the main thread alone
 * between them. A thousand books warm in a couple of minutes, once.
 */
const BACKGROUND_GAP_MS = 90

export function peekCoverImage(id: string): HTMLImageElement | null | undefined {
  const image = images.get(id)
  // Re-inserted on a hit, so the map stays least-recently-drawn first for
  // `remember` to evict from. A delete and a set is nothing next to the draw.
  if (image !== undefined) {
    images.delete(id)
    images.set(id, image)
  }
  return image
}

/** Called when a cover finishes, so whoever drew the book can redraw it. */
export const onCoverReady = new Set<(id: string) => void>()

function decode(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const element = new Image()
    element.crossOrigin = 'anonymous'
    element.onload = () => resolve(element)
    element.onerror = () => resolve(null)
    element.src = url
  })
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && (urgent.length > 0 || background.length > 0)) {
    const fromBackground = urgent.length === 0
    const book = (fromBackground ? background.shift() : urgent.shift())!
    inFlight += 1

    void (async () => {
      let image: HTMLImageElement | null = null
      try {
        const url = await coverFor(book)
        if (url) image = await decode(url)
      } catch {
        image = null
      }
      remember(book.id, image)
      if (image) colours.set(book.id, sample(image))
      inFlight -= 1
      for (const listener of onCoverReady) listener(book.id)
      if (fromBackground) setTimeout(pump, BACKGROUND_GAP_MS)
      else pump()
    })()
  }
}

/**
 * Queue a cover ahead of the background sweep. Safe every frame: the claim is
 * taken when the book is queued rather than when it starts, or a book in flight
 * would be in neither the queue nor the results and get re-queued.
 */
export function coverImageFor(book: IndexedBook) {
  if (claimed.has(book.id)) {
    // Already waiting in the slow lane: promote it, since somebody is looking.
    const at = background.findIndex((queued) => queued.id === book.id)
    if (at >= 0) {
      background.splice(at, 1)
      urgent.push(book)
      pump()
    }
    return
  }
  claimed.add(book.id)
  urgent.push(book)
  pump()
}

/**
 * Warm the whole library in the background, slowly and behind anything urgent,
 * so a library finishes rather than resolving as you approach it.
 */
export function warmCovers(books: readonly IndexedBook[]) {
  for (const book of books) {
    if (claimed.has(book.id)) continue
    claimed.add(book.id)
    background.push(book)
  }
  pump()
}
