import * as THREE from 'three'
import { renderOnePage } from '../reader/source'
import { useLibraryStore } from './library'

/**
 * Page images for books that are open in the *room* rather than in the reader.
 *
 * A book you put down open shows the page you were on, which means rasterising
 * an arbitrary page rather than page one — so this is a second, much smaller
 * cache than the reader's. Deliberately low resolution: nobody reads a book
 * lying on a table across the room, they recognise it, and a spread at 380 px
 * costs a fraction of what the reader's 250-DPI pages do.
 *
 * The reader's page cache is not reused because its lifetime is different:
 * that one is pinned to the spread you are looking at and thrown away when you
 * close the book, and this one has to survive for as long as the book is lying
 * there.
 */

const PAGE_PX = 380
/**
 * How many spreads to keep. Every open book on the floor holds two pages, so
 * this is a couple of dozen books' worth — far more than anyone leaves open,
 * and bounded so that a room used for years does not accumulate textures.
 */
const CAPACITY = 48

const cache = new Map<string, THREE.Texture>()
const pending = new Map<string, Promise<THREE.Texture | null>>()

const key = (bookId: string, page: number) => `${bookId}:${page}`

/** Whatever is already decoded, for a component that must not suspend. */
export function peekPage(bookId: string, page: number): THREE.Texture | undefined {
  return cache.get(key(bookId, page))
}

/** Drop the oldest entries once the cache is over its bound. */
function trim() {
  while (cache.size > CAPACITY) {
    const oldest = cache.keys().next()
    if (oldest.done) break
    cache.get(oldest.value)?.dispose()
    cache.delete(oldest.value)
  }
}

/**
 * Rasterise one page, once. Failures resolve to null rather than throwing: a
 * book that will not render is a book lying face down, not an error dialog.
 */
export function pageTexture(bookId: string, page: number): Promise<THREE.Texture | null> {
  const id = key(bookId, page)
  const ready = cache.get(id)
  if (ready) return Promise.resolve(ready)
  const running = pending.get(id)
  if (running) return running

  const job = (async (): Promise<THREE.Texture | null> => {
    try {
      // The book as the index has it, because the format is what decides
      // whether this is a rasterised page or one that has to be set in type
      // first. A book the index has never heard of has no pages to draw.
      const book = useLibraryStore.getState().byId.get(bookId)
      if (!book) return null
      // The texture outlives the document on purpose: it is the document that
      // costs the memory, and `renderOnePage` lets go of it as soon as the
      // page is out.
      const canvas = await renderOnePage(book, page, PAGE_PX)
      if (!canvas) return null
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      cache.set(id, texture)
      trim()
      return texture
    } catch {
      return null
    } finally {
      pending.delete(id)
    }
  })()

  pending.set(id, job)
  return job
}

/** Called when a book stops being open anywhere, so its pages can go. */
export function releaseBook(bookId: string) {
  for (const id of [...cache.keys()]) {
    if (!id.startsWith(`${bookId}:`)) continue
    cache.get(id)?.dispose()
    cache.delete(id)
  }
}
