import * as THREE from 'three'

/**
 * Surfaces shared by every room. Sizes and positions come from the world
 * document; what a floor or a wall *is* does not, because that is a decision
 * about what a library looks like rather than about your library.
 */
export const MATERIALS = {
  /**
   * Limewashed boards rather than plaster: this is a cabin, not a gallery.
   * Deliberately a shade deeper and warmer than a paint-chip cream — the pale
   * flat beige it replaced read as office partition, not as timber with wash
   * on it.
   */
  wall: '#d8c4a3',
  /** Skirting in wood, not trim-paint: the wall meets the floor in timber. */
  skirting: '#9a7248',
  /** Exposed rafters and the lintel over an opening. */
  timber: '#6d4b2e',
  carcass: '#8a6039',
  stone: '#948b7c',
  /**
   * Cedar shingles gone grey, which is what a roof in the woods is after one
   * winter. Deliberately much darker than the walls: a roof the colour of its
   * timber makes the whole building one blur from the far side of the lake.
   */
  shingle: '#4b4740',
  /** The boards you see under the eaves, looking up from outside. */
  soffit: '#8f6f4c',
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
  boards: { r: 146, g: 101, b: 58, plank: PLANK_WIDTH_M, seam: 'rgba(40, 24, 12, 0.5)' },
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

/**
 * Limewash for the walls: near-white streaks and soft blotches, *multiplied*
 * under the material's `color`, so `MATERIALS.wall` stays the one place the
 * tint is decided. The walls are the largest surfaces indoors and were the
 * only ones with no texture at all — flat fill is what read as CG, not the
 * palette. One module-level texture: every room's shell shares one upload.
 */
let wallWash: THREE.CanvasTexture | null = null
export function wallWashTexture(): THREE.CanvasTexture {
  if (wallWash) return wallWash
  const size = 512
  const random = mulberry32(0x77a1)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // A hair under white, so streaks can go lighter as well as darker.
  ctx.fillStyle = '#f5f3ef'
  ctx.fillRect(0, 0, size, size)

  // Broad soft blotches: plaster is never one value across a whole wall.
  for (let i = 0; i < 70; i++) {
    const x = random() * size
    const y = random() * size
    const r = 40 + random() * 110
    const tone = random() > 0.5 ? '255, 255, 255' : '210, 205, 196'
    const blotch = ctx.createRadialGradient(x, y, 0, x, y, r)
    blotch.addColorStop(0, `rgba(${tone}, 0.10)`)
    blotch.addColorStop(1, `rgba(${tone}, 0)`)
    ctx.fillStyle = blotch
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Vertical brush streaks, low contrast: the drag of the wash, not boards.
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 420; i++) {
    const x = random() * size
    const y = random() * size
    const len = 30 + random() * 150
    ctx.strokeStyle = random() > 0.5 ? '#ffffff' : '#c9c2b4'
    ctx.lineWidth = 0.6 + random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (random() - 0.5) * 3, y + len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  wallWash = new THREE.CanvasTexture(canvas)
  wallWash.colorSpace = THREE.SRGBColorSpace
  wallWash.wrapS = THREE.RepeatWrapping
  wallWash.wrapT = THREE.RepeatWrapping
  return wallWash
}

/**
 * Mottle for the outdoor ground, the same multiplied-under-colour trick as the
 * wall wash: two-tone grass patches in neutral greys, tiled every few metres.
 * Without it the whole valley floor is one flat swatch — the billiard table
 * that no amount of trees quite makes up for.
 */
let groundMottle: THREE.CanvasTexture | null = null
export function groundMottleTexture(): THREE.CanvasTexture {
  if (groundMottle) return groundMottle
  const size = 256
  const random = mulberry32(0x9e0f)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f2f1ee'
  ctx.fillRect(0, 0, size, size)

  // Two sizes of patch: broad drifts, then small tufts over them.
  for (let i = 0; i < 60; i++) {
    const x = random() * size
    const y = random() * size
    const r = 18 + random() * 46
    const tone = random() > 0.45 ? '255, 255, 255' : '205, 204, 196'
    const patch = ctx.createRadialGradient(x, y, 0, x, y, r)
    patch.addColorStop(0, `rgba(${tone}, 0.14)`)
    patch.addColorStop(1, `rgba(${tone}, 0)`)
    ctx.fillStyle = patch
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.globalAlpha = 0.08
  for (let i = 0; i < 900; i++) {
    const x = random() * size
    const y = random() * size
    ctx.fillStyle = random() > 0.5 ? '#ffffff' : '#b9b8ae'
    ctx.fillRect(x, y, 1 + random() * 2, 1 + random() * 2)
  }
  ctx.globalAlpha = 1

  groundMottle = new THREE.CanvasTexture(canvas)
  groundMottle.colorSpace = THREE.SRGBColorSpace
  groundMottle.wrapS = THREE.RepeatWrapping
  groundMottle.wrapT = THREE.RepeatWrapping
  return groundMottle
}
