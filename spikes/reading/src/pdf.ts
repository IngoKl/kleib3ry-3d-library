import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as THREE from 'three'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Rasterises PDF pages to canvas-backed textures.
 *
 * This is the in-WebView tier of the spec's two-tier strategy. The real app
 * would pre-rasterise at 150 DPI in a Rust sidecar and use this path only for
 * the on-demand high-DPI page being held close -- but for the purpose of the
 * spike (is the *result* legible on a curved mesh?) the pixel source is
 * irrelevant, so doing it all here keeps the loop fast.
 */

export type PageTexture = {
  texture: THREE.CanvasTexture
  widthPx: number
  heightPx: number
  aspect: number
  bytes: number
}

const BLANK = Symbol('blank')

export async function loadDocument(src: string | ArrayBuffer): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    ...(typeof src === 'string' ? { url: src } : { data: new Uint8Array(src) }),
    standardFontDataUrl: '/standard_fonts/',
    cMapUrl: '/cmaps/',
    cMapPacked: true,
  })
  return task.promise
}

/** pdf.js renders one page at a time per document; serialise to avoid thrash. */
let chain: Promise<unknown> = Promise.resolve()
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

function makeBlankCanvas(widthPx: number, heightPx: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthPx))
  canvas.height = Math.max(1, Math.round(heightPx))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f4f0e6'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

async function rasterise(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetHeightPx: number,
  maxTextureSize: number,
): Promise<HTMLCanvasElement | typeof BLANK> {
  if (pageNumber < 1 || pageNumber > doc.numPages) return BLANK
  const page = await doc.getPage(pageNumber)
  const unit = page.getViewport({ scale: 1 })
  // Scale so the rendered page is `targetHeightPx` tall, clamped to what the
  // GPU can actually hold.
  const byHeight = targetHeightPx / unit.height
  const cap = Math.min(maxTextureSize / unit.height, maxTextureSize / unit.width)
  const scale = Math.max(0.1, Math.min(byHeight, cap))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  page.cleanup()
  return canvas
}

export class PageTextureCache {
  private map = new Map<string, PageTexture>()
  private pending = new Map<string, Promise<PageTexture>>()
  private maxTextureSize: number
  private anisotropy: number

  constructor(renderer: THREE.WebGLRenderer) {
    this.maxTextureSize = renderer.capabilities.maxTextureSize
    this.anisotropy = renderer.capabilities.getMaxAnisotropy()
  }

  get maxAnisotropy() {
    return this.anisotropy
  }

  /** Total GPU bytes held, including mipmap tail. */
  get bytes() {
    let total = 0
    for (const entry of this.map.values()) total += entry.bytes
    return total
  }

  get size() {
    return this.map.size
  }

  key(pageNumber: number, targetHeightPx: number) {
    return `${pageNumber}@${Math.round(targetHeightPx)}`
  }

  peek(pageNumber: number, targetHeightPx: number) {
    return this.map.get(this.key(pageNumber, targetHeightPx))
  }

  /** Best already-resident texture for a page at any resolution, for instant display. */
  peekAny(pageNumber: number): PageTexture | undefined {
    let best: PageTexture | undefined
    for (const [k, v] of this.map) {
      if (!k.startsWith(`${pageNumber}@`)) continue
      if (!best || v.heightPx > best.heightPx) best = v
    }
    return best
  }

  async get(
    doc: PDFDocumentProxy,
    pageNumber: number,
    targetHeightPx: number,
    useAnisotropy: boolean,
    useMipmaps: boolean,
  ): Promise<PageTexture> {
    const key = this.key(pageNumber, targetHeightPx)
    const hit = this.map.get(key)
    if (hit) return hit
    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const job = serialise(async () => {
      const result = await rasterise(doc, pageNumber, targetHeightPx, this.maxTextureSize)
      const canvas =
        result === BLANK
          ? makeBlankCanvas(targetHeightPx * 0.7727, targetHeightPx)
          : result
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = useAnisotropy ? this.anisotropy : 1
      texture.generateMipmaps = useMipmaps
      texture.minFilter = useMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      texture.needsUpdate = true

      const entry: PageTexture = {
        texture,
        widthPx: canvas.width,
        heightPx: canvas.height,
        aspect: canvas.width / canvas.height,
        bytes: canvas.width * canvas.height * 4 * (useMipmaps ? 1.34 : 1),
      }
      this.map.set(key, entry)
      this.pending.delete(key)
      return entry
    })

    this.pending.set(key, job)
    return job
  }

  /**
   * Anisotropy and mip settings are texture state, not pixel state, so a
   * toggle can be applied in place -- no re-rasterisation, no cache flush.
   */
  applyFilterSettings(useAnisotropy: boolean, useMipmaps: boolean) {
    for (const entry of this.map.values()) {
      const t = entry.texture
      t.anisotropy = useAnisotropy ? this.anisotropy : 1
      t.generateMipmaps = useMipmaps
      t.minFilter = useMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
      t.needsUpdate = true
    }
  }

  /** Drop everything not in `keep`, freeing GPU memory. */
  evictExcept(keep: Set<string>, budgetBytes: number) {
    if (this.bytes <= budgetBytes) return
    for (const [k, v] of [...this.map].reverse()) {
      if (this.bytes <= budgetBytes) break
      if (keep.has(k)) continue
      v.texture.dispose()
      this.map.delete(k)
    }
  }

  disposeAll() {
    for (const v of this.map.values()) v.texture.dispose()
    this.map.clear()
    this.pending.clear()
  }
}
