import * as THREE from 'three'
import { renderOnePage } from '../reader/source'
import { useLibraryStore } from './library'

/**
 * Page images for books open in the room rather than in the reader. Deliberately
 * low resolution: nobody reads a book lying on a table across the room, they
 * recognise it. Its own cache because the lifetimes differ — the reader's is
 * pinned to a spread and dropped on close, this one lasts as long as the book
 * is lying there.
 */

const PAGE_PX = 380
/**
 * A couple of dozen open books' worth — more than anyone leaves out, and bounded
 * so a room used for years does not accumulate textures.
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

/** Failures resolve to null: a book that will not render lies face down, not in a dialog. */
export function pageTexture(bookId: string, page: number): Promise<THREE.Texture | null> {
  const id = key(bookId, page)
  const ready = cache.get(id)
  if (ready) return Promise.resolve(ready)
  const running = pending.get(id)
  if (running) return running

  const job = (async (): Promise<THREE.Texture | null> => {
    try {
      // The format decides whether this is a rasterised page or one to be set
      // in type first, and an unknown book has no pages to draw.
      const book = useLibraryStore.getState().byId.get(bookId)
      if (!book) return null
      // The texture outlives the document deliberately: the document is what
      // costs memory, and `renderOnePage` drops it once the page is out.
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
