import * as THREE from 'three'
import { renderOnePage } from '../reader/source'
import { paintPageStrokes } from '../reader/pageInk'
import { useLibraryStore } from '../state/library'
import { useAnnotationsStore } from '../state/annotations'
import type { BoardStroke } from '../services/types'

/**
 * Artwork for the pinned sheets, kept out of `Pinned.tsx` because both are caches
 * outliving any component. A page is rasterised by opening its book, and a wall
 * of a dozen must not re-open a dozen documents on every re-render.
 */

/** Sheets are a shade over life size, like everything else here. */
export const SHEET = { width: 0.2625, height: 0.371 }
/** A 76 mm note, at the same scale. */
export const NOTE = 0.116

/**
 * Lower than the reader's, which docks the camera on a spread: a pinned page is
 * read from across a desk, and a wall of them at reader DPI is a hundred
 * megabytes of texture on a whiteboard.
 */
const PAGE_PX = 900

/** The pads a note can come off. Ordinary highlighter colours, deliberately. */
export const NOTE_COLOURS = ['#f2e06a', '#f2a8a0', '#a8dcf0', '#bfe6a0', '#e3c3ef']

type PageArt = {
  bookId: string
  page: number
  texture: THREE.Texture | null
  /**
   * By identity, since the store keeps the same array until the ink changes.
   * Compared rather than counted: a wipe then a redraw is one stroke again.
   */
  ink: readonly BoardStroke[] | undefined
}

const pages = new Map<string, PageArt>()
const inflight = new Map<string, Promise<THREE.Texture | null>>()

/** Also the key `onPageReady` publishes, so a listener can compare against it. */
export const pageKey = (bookId: string, page: number) => `${bookId}:${page}`

/** The ink on a page, as the store holds it — `undefined`, not `[]`, for none. */
const inkOf = (bookId: string, page: number): readonly BoardStroke[] | undefined =>
  useAnnotationsStore.getState().drawings[bookId]?.[page]

export function peekPage(bookId: string, page: number): THREE.Texture | null | undefined {
  return pages.get(pageKey(bookId, page))?.texture
}

/**
 * Rasterised once and kept, unlike the reader's page cache: a pinned page is on
 * a wall because you put it there, and fading to blank to save a few megabytes
 * is the wrong trade. Bounded naturally, since you make each one by hand.
 */
export function pageTextureFor(bookId: string, page: number): Promise<THREE.Texture | null> {
  const key = pageKey(bookId, page)
  const known = pages.get(key)
  if (known && known.ink === inkOf(bookId, page)) return Promise.resolve(known.texture)
  const running = inflight.get(key)
  if (running) return running

  const job = (async (): Promise<PageArt> => {
    const blank = { bookId, page, texture: null, ink: inkOf(bookId, page) }
    try {
      // Through the source rather than pdf.js: an EPUB page must be set in type
      // first, and the rasteriser alone pins a blank sheet. `renderOnePage`
      // also releases the document, or a wall of pages pins a wall of books.
      const book = useLibraryStore.getState().byId.get(bookId)
      if (!book) return blank
      const canvas = await renderOnePage(book, page, PAGE_PX)
      if (!canvas) return blank
      // The reader's own painter: a torn-out page is a copy, marginalia and
      // all, and two stroke renderers are two answers to where the ink goes.
      const ink = inkOf(bookId, page)
      paintPageStrokes(canvas, ink ?? [])
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.needsUpdate = true
      return { bookId, page, texture, ink }
    } catch {
      return blank
    }
  })()

  const result = job.then((art) => art.texture)
  inflight.set(key, result)
  void job.then((art) => {
    const previous = pages.get(key)
    pages.set(key, art)
    inflight.delete(key)
    // Safe while a material still holds it: three re-uploads a disposed texture
    // from its canvas. Not disposing leaks a page-sized texture per re-ink.
    previous?.texture?.dispose()
    notifyPageReady(bookId, page)
    // Ink that landed while the page was rasterising is not in the raster.
    if (art.ink !== inkOf(bookId, page)) scheduleInkSweep()
  })
  return result
}

/**
 * A page here comes off its document rather than a cache, so redrawing per
 * stroke is a parse per stroke — and the sheet is behind you while you draw.
 */
const INK_SETTLE_MS = 600

let sweepTimer: ReturnType<typeof setTimeout> | undefined

function scheduleInkSweep() {
  clearTimeout(sweepTimer)
  sweepTimer = setTimeout(() => {
    sweepTimer = undefined
    for (const art of [...pages.values()]) {
      if (art.ink !== inkOf(art.bookId, art.page)) void pageTextureFor(art.bookId, art.page)
    }
  }, INK_SETTLE_MS)
}

// The cache outlives every component that reads it, so a page drawn on after
// its sheet went up would otherwise keep the ink it had when you tore it out.
useAnnotationsStore.subscribe((state, previous) => {
  if (state.drawings !== previous.drawings) scheduleInkSweep()
})

/** Called when a page finishes rasterising, so the sheet showing it redraws. */
export const onPageReady = new Set<(key: string) => void>()

function notifyPageReady(bookId: string, page: number) {
  for (const listener of onPageReady) listener(pageKey(bookId, page))
}

/**
 * Handwriting on a square of coloured paper, wrapped by hand: the only thing
 * that has to work is a few words on a small square, and the failure mode is a
 * word running off the edge, which the clip catches.
 */
export function noteTexture(text: string, colour: number): THREE.CanvasTexture {
  const size = 384
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const paper = NOTE_COLOURS[colour % NOTE_COLOURS.length]!
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, size, size)

  // The gummed strip along the top, a shade darker, which is the one detail
  // that makes a coloured square read as a note.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
  ctx.fillRect(0, 0, size, size * 0.14)

  ctx.fillStyle = '#2a2f3a'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const margin = size * 0.1
  const available = size - margin * 2
  // Bigger type for less text: a three-word note should fill its square.
  let font = text.length <= 12 ? 44 : text.length <= 40 ? 32 : 24
  let lines: string[] = []

  for (; font >= 16; font -= 2) {
    ctx.font = `500 ${font}px "Segoe UI", system-ui, sans-serif`
    lines = wrap(ctx, text, available)
    if (lines.length * font * 1.28 <= size - margin * 2 - size * 0.1) break
  }

  ctx.font = `500 ${font}px "Segoe UI", system-ui, sans-serif`
  let y = margin + size * 0.09
  for (const line of lines) {
    ctx.fillText(line, margin, y, available)
    y += font * 1.28
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Greedy word wrap. A single word too long for the line is left to be clipped. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= width || !line) {
      line = candidate
    } else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}
