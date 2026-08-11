import * as THREE from 'three'

/**
 * Surfaces shared by every room. Sizes and positions come from the world
 * document; what a floor or a wall *is* does not, because that is a decision
 * about what a library looks like rather than about your library.
 */
export const MATERIALS = {
  /** Limewashed boards rather than plaster: this is a cabin, not a gallery. */
  wall: '#e3d8c4',
  ceiling: '#efe6d5',
  skirting: '#c9b494',
  /** Exposed rafters and the lintel over an opening. */
  timber: '#6d4b2e',
  daylight: '#cfe2f2',
  carcass: '#8a6039',
  /** Deck boards on the porch, weathered a shade greyer than indoors. */
  deck: '#8b7358',
  stone: '#9a948b',
} as const

/** One texture tile covers this many metres of floor in each direction. */
const FLOOR_TILE_M = 2.4
/** Board width in metres -- narrow enough to read as flooring, not panelling. */
const PLANK_WIDTH_M = 0.15

/** Deterministic PRNG, so the floor is identical on every run and in every screenshot. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The three floors a room can have, as base colour plus how far the boards vary.
 *
 * Decking is the same drawing with a wider board, a greyer tone and a gap
 * between the boards, because that is genuinely what the difference looks like
 * from standing height — and a porch that reads as indoor flooring undoes the
 * point of having gone outside.
 */
const FINISHES = {
  boards: { r: 138, g: 100, b: 64, plank: PLANK_WIDTH_M, seam: 'rgba(40, 24, 12, 0.5)' },
  deck: { r: 128, g: 110, b: 86, plank: 0.22, seam: 'rgba(30, 24, 16, 0.75)' },
  stone: { r: 150, g: 145, b: 136, plank: 0.6, seam: 'rgba(60, 58, 54, 0.55)' },
  /** Pale spruce for overhead: a cabin ceiling is boards, not plaster. */
  ceiling: { r: 176, g: 142, b: 100, plank: 0.14, seam: 'rgba(62, 42, 24, 0.4)' },
} as const

export type FloorFinishName = keyof typeof FINISHES

/**
 * Oak planks, drawn once into a canvas rather than shipped as an asset: it
 * keeps the repo text-only and the parameters legible.
 */
export function makeFloorTexture(
  width: number,
  depth: number,
  finish: FloorFinishName = 'boards',
): THREE.CanvasTexture {
  const size = 1024
  const style = FINISHES[finish]
  const planks = Math.max(2, Math.round(FLOOR_TILE_M / style.plank))
  const plankHeight = size / planks
  const random = mulberry32(0x1b7a)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = `rgb(${style.r}, ${style.g}, ${style.b})`
  ctx.fillRect(0, 0, size, size)

  type Board = { x: number; y: number; w: number }
  const boards: Board[] = []

  for (let row = 0; row < planks; row++) {
    const y = row * plankHeight
    // Stagger the end joints and vary board length so no two rows line up.
    let x = -random() * size * 0.5
    while (x < size) {
      const w = size * (0.38 + random() * 0.34)
      boards.push({ x, y, w })
      // Keep the tint range tight; large jumps read as a checkerboard.
      const shade = 0.93 + random() * 0.12
      ctx.fillStyle = `rgb(${(style.r * shade) | 0}, ${(style.g * shade) | 0}, ${(style.b * shade) | 0})`
      ctx.fillRect(x, y, w, plankHeight)
      x += w
    }
  }

  // Grain: long, low-contrast streaks running with the boards.
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 2600; i++) {
    const y = random() * size
    const x = random() * size
    const len = 40 + random() * 220
    ctx.strokeStyle = random() > 0.5 ? '#000000' : '#d8a878'
    ctx.lineWidth = 0.5 + random()
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + len, y + (random() - 0.5) * 1.5)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Seams: between rows, and at every end joint.
  ctx.strokeStyle = style.seam
  ctx.lineWidth = 1.5
  for (let row = 0; row <= planks; row++) {
    const y = row * plankHeight
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }
  for (const board of boards) {
    ctx.beginPath()
    ctx.moveTo(board.x, board.y)
    ctx.lineTo(board.x, board.y + plankHeight)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(width / FLOOR_TILE_M, depth / FLOOR_TILE_M)
  return texture
}
