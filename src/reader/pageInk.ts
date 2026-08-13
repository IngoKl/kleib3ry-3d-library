import { inkAt } from '../data/inks'
import type { BoardStroke } from '../services/types'

/**
 * Ink drawn on a page of a book, with the whiteboard's own conventions:
 * strokes in page space — `u` across, `v` up, 0 to 1 — a live stroke as a
 * plain mutable object outside the store, and a commit once, on letting go.
 *
 * Page space rather than canvas pixels because the same page rasterises at a
 * different size on every monitor, and the ink has to land in the same place
 * on all of them. Unlike a whiteboard the ground truth is not a canvas the
 * painter owns: it is the rasterised page itself, so strokes are drawn *onto*
 * the page's canvas — live a segment at a time, and in full when a page is
 * rendered fresh (see the decorate hook in `pageTextures.ts`).
 */

/** The pen the margins are written in. One of the marker inks, not a choice. */
export const PAGE_INK = 1

/** Line width, as a fraction of the page's height. Finer than a marker. */
const NIB = 0.006

/** How far the pointer must travel, in page space, before a point is kept. */
export const MIN_STEP = 0.004

export const pageDrawing: {
  /** Page being drawn on, or null when the pen is up. */
  page: number | null
  /** Flattened u, v pairs. */
  points: number[]
} = { page: null, points: [] }

export function startPageStroke(page: number, u: number, v: number) {
  pageDrawing.page = page
  pageDrawing.points = [u, v]
}

/** Extend the live stroke. Returns false if the point was too close to keep. */
export function extendPageStroke(u: number, v: number): boolean {
  const points = pageDrawing.points
  const lastU = points[points.length - 2]
  const lastV = points[points.length - 1]
  if (lastU !== undefined && lastV !== undefined) {
    if (Math.hypot(u - lastU, v - lastV) < MIN_STEP) return false
  }
  points.push(u, v)
  return true
}

/** Finish the live stroke and hand it back, with the page it belongs to. */
export function endPageStroke(): { page: number; stroke: BoardStroke } | null {
  const { page, points } = pageDrawing
  pageDrawing.page = null
  pageDrawing.points = []
  if (page === null || points.length < 2) return null
  return { page, stroke: { ink: PAGE_INK, points } }
}

function pen(ctx: CanvasRenderingContext2D, ink: number, height: number) {
  ctx.strokeStyle = inkAt(ink)
  ctx.lineWidth = Math.max(1.5, NIB * height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

function path(ctx: CanvasRenderingContext2D, points: readonly number[], w: number, h: number) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0]! * w, (1 - points[1]!) * h)
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i]! * w, (1 - points[i + 1]!) * h)
  }
  // A one-point path draws nothing, so a dot is a hair of a line.
  if (points.length === 2) ctx.lineTo(points[0]! * w + 0.01, (1 - points[1]!) * h)
  ctx.stroke()
}

/**
 * A rasterised page's context is reused, and the rasteriser may have left a
 * transform on it — the EPUB type setter draws in abstract units through a
 * `scale()` it never resets. The ink speaks device pixels, so it draws under
 * an identity transform and puts everything back afterwards.
 */
function withInkContext(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  draw(ctx)
  ctx.restore()
}

/** Paint a page's saved strokes onto its freshly rasterised canvas. */
export function paintPageStrokes(canvas: HTMLCanvasElement, strokes: readonly BoardStroke[]) {
  if (!strokes.length) return
  withInkContext(canvas, (ctx) => {
    for (const stroke of strokes) {
      pen(ctx, stroke.ink, canvas.height)
      path(ctx, stroke.points, canvas.width, canvas.height)
    }
  })
}

/** Draw only the last segment of the live stroke — the per-frame path. */
export function extendOnCanvas(canvas: HTMLCanvasElement) {
  withInkContext(canvas, (ctx) => {
    const points = pageDrawing.points
    pen(ctx, PAGE_INK, canvas.height)
    if (points.length === 2) {
      path(ctx, points, canvas.width, canvas.height)
      return
    }
    if (points.length < 4) return
    ctx.beginPath()
    ctx.moveTo(
      points[points.length - 4]! * canvas.width,
      (1 - points[points.length - 3]!) * canvas.height,
    )
    ctx.lineTo(
      points[points.length - 2]! * canvas.width,
      (1 - points[points.length - 1]!) * canvas.height,
    )
    ctx.stroke()
  })
}
