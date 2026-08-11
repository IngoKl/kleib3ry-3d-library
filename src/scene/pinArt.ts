import * as THREE from 'three'
import { renderOnePage } from '../reader/source'
import { useLibraryStore } from '../state/library'

/**
 * Artwork for the sheets pinned up round the house: a page copied out of a book,
 * or a note somebody typed.
 *
 * Kept out of `Pinned.tsx` because both are caches with a lifetime longer than
 * any component's. A page has to be rasterised through pdf.js, which means
 * opening the book — and a wall of a dozen torn-out pages must not re-open a
 * dozen documents every time the sheet's material happens to re-render.
 */

/** Sheets are a shade over life size, like everything else here. */
export const SHEET = { width: 0.2625, height: 0.371 }
/** A 76 mm note, at the same scale. */
export const NOTE = 0.116

/**
 * How tall a torn-out page is rasterised.
 *
 * Lower than the reader's, which docks the camera on a spread and is capped by
 * screen pixels. A pinned page is read from across a desk at most, and a wall of
 * them at reader DPI would be a hundred megabytes of texture on a whiteboard.
 */
const PAGE_PX = 900

/** The pads a note can come off. Ordinary highlighter colours, deliberately. */
export const NOTE_COLOURS = ['#f2e06a', '#f2a8a0', '#a8dcf0', '#bfe6a0', '#e3c3ef']

const pages = new Map<string, THREE.Texture | null>()
const inflight = new Map<string, Promise<THREE.Texture | null>>()

const keyOf = (bookId: string, page: number) => `${bookId}:${page}`

export function peekPage(bookId: string, page: number): THREE.Texture | null | undefined {
  return pages.get(keyOf(bookId, page))
}

/**
 * The texture for one page of one book, rasterised once and kept.
 *
 * Kept rather than evicted, unlike the reader's page cache: a pinned page is on
 * a wall because you put it there, and having it fade to blank while you are
 * looking at it to save a few megabytes would be the wrong trade. There is a
 * natural bound on how many you make, because you make each one by hand.
 */
export function pageTextureFor(bookId: string, page: number): Promise<THREE.Texture | null> {
  const key = keyOf(bookId, page)
  const known = pages.get(key)
  if (known !== undefined) return Promise.resolve(known)
  const running = inflight.get(key)
  if (running) return running

  const job = (async (): Promise<THREE.Texture | null> => {
    try {
      // Through the source rather than through pdf.js: a page torn out of an
      // EPUB has to be set in type before it can be drawn, and going straight
      // to the rasteriser pinned a blank sheet to the wall. `renderOnePage`
      // also lets the document go the moment the page is out of it — a parsed
      // PDF pins its whole file in the pdf.js worker, and a wall of pages from
      // a wall of books would otherwise pin all of them.
      const book = useLibraryStore.getState().byId.get(bookId)
      if (!book) return null
      const canvas = await renderOnePage(book, page, PAGE_PX)
      if (!canvas) return null
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.needsUpdate = true
      return texture
    } catch {
      return null
    }
  })()

  inflight.set(key, job)
  void job.then((texture) => {
    pages.set(key, texture)
    inflight.delete(key)
  })
  return job
}

/** Called when a page finishes rasterising, so the sheet showing it redraws. */
export const onPageReady = new Set<(key: string) => void>()

export function notifyPageReady(bookId: string, page: number) {
  for (const listener of onPageReady) listener(keyOf(bookId, page))
}

/**
 * A note, drawn as handwriting on a square of coloured paper.
 *
 * Wrapped by hand rather than with any text-layout machinery, because the only
 * thing that has to work is "a few words on a small square", and the failure
 * mode of getting it wrong is a word running off the edge — which the clip
 * catches. Cheap, and it means a note is a canvas rather than a font asset.
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
