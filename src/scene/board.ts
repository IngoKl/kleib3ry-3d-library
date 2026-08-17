import * as THREE from 'three'
import { inkAt } from '../data/inks'
import type { BoardStroke } from '../services/types'

/**
 * What is drawn on the whiteboards. Strokes are in board space — `u` across, `v`
 * up, 0 to 1 — so a resized board keeps its drawing and canvas resolution stays
 * a rendering decision. The live stroke is a plain mutable object: it gains a
 * point per frame and lands in the layout once, when you let go.
 */

/** Line width, as a fraction of the board's height. */
const NIB = 0.016

/** How far the crosshair must travel, in board space, before a point is kept. */
export const MIN_STEP = 0.004

export const drawing: {
  /** Whiteboard being drawn on, or null when the marker is not down. */
  boardId: string | null
  ink: number
  /** Flattened u, v pairs. */
  points: number[]
  /** Bumped per point added, so the painter can tell there is new ink. */
  revision: number
} = { boardId: null, ink: 0, points: [], revision: 0 }

export function startStroke(boardId: string, ink: number, u: number, v: number) {
  drawing.boardId = boardId
  drawing.ink = ink
  drawing.points = [u, v]
  drawing.revision += 1
}

/** Extend the live stroke. Returns false if the point was too close to keep. */
export function extendStroke(u: number, v: number): boolean {
  const points = drawing.points
  const lastU = points[points.length - 2]
  const lastV = points[points.length - 1]
  if (lastU !== undefined && lastV !== undefined) {
    if (Math.hypot(u - lastU, v - lastV) < MIN_STEP) return false
  }
  points.push(u, v)
  drawing.revision += 1
  return true
}

/** Finish the live stroke and hand it back, with the board it belongs to. */
export function endStroke(): { boardId: string; stroke: BoardStroke } | null {
  const { boardId, ink, points } = drawing
  drawing.boardId = null
  drawing.points = []
  drawing.revision += 1
  // One point is a dot and worth keeping; none is nothing.
  if (!boardId || points.length < 2) return null
  return { boardId, stroke: { ink, points } }
}

/** Cap on a board texture's longest side. */
const MAX_PX = 2048

export type BoardCanvas = {
  texture: THREE.CanvasTexture
  /** Repaint from scratch: the whole saved list, then whatever is live. */
  repaint(strokes: readonly BoardStroke[]): void
  /** Draw only the last segment of the live stroke — the per-frame path. */
  extend(): void
  dispose(): void
}

/** A canvas at the board's own proportions, so ink is as thick across as up. */

export function makeBoardCanvas(width: number, height: number): BoardCanvas {
  const scale = Math.min(MAX_PX / width, MAX_PX / height, 600)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(width * scale))
  canvas.height = Math.max(2, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4

  const px = (u: number) => u * canvas.width
  const py = (v: number) => (1 - v) * canvas.height

  const pen = (ink: number) => {
    ctx.strokeStyle = inkAt(ink)
    ctx.lineWidth = Math.max(1.5, NIB * canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  const path = (points: readonly number[]) => {
    if (points.length < 2) return
    ctx.beginPath()
    ctx.moveTo(px(points[0]!), py(points[1]!))
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(px(points[i]!), py(points[i + 1]!))
    // A one-point path draws nothing, so a dot is a hair of a line.
    if (points.length === 2) ctx.lineTo(px(points[0]!) + 0.01, py(points[1]!))
    ctx.stroke()
  }

  const clear = () => {
    ctx.fillStyle = '#eef0ee'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  clear()

  return {
    texture,
    repaint: (strokes) => {
      clear()
      for (const stroke of strokes) {
        pen(stroke.ink)
        path(stroke.points)
      }
      if (drawing.points.length) {
        pen(drawing.ink)
        path(drawing.points)
      }
      texture.needsUpdate = true
    },
    extend: () => {
      const points = drawing.points
      if (points.length < 4) {
        // The first point has nothing to join to; draw it as a dot.
        if (points.length === 2) {
          pen(drawing.ink)
          path(points)
          texture.needsUpdate = true
        }
        return
      }
      pen(drawing.ink)
      ctx.beginPath()
      ctx.moveTo(px(points[points.length - 4]!), py(points[points.length - 3]!))
      ctx.lineTo(px(points[points.length - 2]!), py(points[points.length - 1]!))
      ctx.stroke()
      texture.needsUpdate = true
    },
    dispose: () => texture.dispose(),
  }
}
