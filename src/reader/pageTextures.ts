import * as THREE from 'three'
import type { PageSource } from './source'

/**
 * Rasterised pages held as textures, so a spread that has already been through
 * the worker appears in the *same frame* it is asked for.
 *
 * Nothing rasterises on demand at commit time. The destination spread is
 * rendered while the leaf is still swinging and the commit reads `peek`, so the
 * swap is atomic or it does not happen yet.
 *
 * Textures are big — a spread at reading DPI is ~13 MB each before mipmaps — so
 * the cache is deliberately tiny: the spread in hand plus one either side, which
 * is exactly what makes a turn in either direction instant.
 */

const CAPACITY = 8

/** Current spread, the one before it, and the one after: six page numbers. */
export function spreadWindow(spread: number): number[] {
  const first = 2 * spread - 2
  return [0, 1, 2, 3, 4, 5].map((offset) => first + offset).filter((page) => page >= 1)
}

export type PageTextures = {
  /** The texture if it is rasterised, `undefined` if it is not yet. */
  peek(page: number): THREE.Texture | null | undefined
  load(page: number): Promise<THREE.Texture | null>
  /** Page numbers a material is currently showing; these survive eviction. */
  pin(pages: number[]): void
  dispose(): void
}

export function makePageTextures(
  source: PageSource,
  targetPx: number,
  gl: THREE.WebGLRenderer,
): PageTextures {
  const ready = new Map<number, THREE.Texture | null>()
  const inflight = new Map<number, Promise<THREE.Texture | null>>()
  let pinned = new Set<number>()
  let disposed = false

  const maxTexture = gl.capabilities.maxTextureSize
  const anisotropy = gl.capabilities.getMaxAnisotropy()

  /** Oldest first — a Map iterates in insertion order — but never anything on screen. */
  const evict = () => {
    for (const page of [...ready.keys()]) {
      if (ready.size <= CAPACITY) return
      if (pinned.has(page)) continue
      ready.get(page)?.dispose()
      ready.delete(page)
    }
  }

  const load = (page: number): Promise<THREE.Texture | null> => {
    if (ready.has(page)) return Promise.resolve(ready.get(page)!)
    const existing = inflight.get(page)
    if (existing) return existing

    const job = (async () => {
      const canvas = await source.render(page, targetPx, maxTexture)
      inflight.delete(page)
      // Past the last page the source answers null; cache that too, so the
      // final spread commits instead of waiting forever on a page that is not
      // coming.
      if (disposed) return null

      let texture: THREE.Texture | null = null
      if (canvas) {
        texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = anisotropy
        texture.minFilter = THREE.LinearMipmapLinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.needsUpdate = true
      }
      ready.set(page, texture)
      evict()
      return texture
    })()

    inflight.set(page, job)
    return job
  }

  return {
    peek: (page) => ready.get(page),
    load,
    pin: (pages) => {
      pinned = new Set(pages)
    },
    dispose: () => {
      disposed = true
      for (const texture of ready.values()) texture?.dispose()
      ready.clear()
      inflight.clear()
    },
  }
}
