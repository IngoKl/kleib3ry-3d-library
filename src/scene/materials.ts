import * as THREE from 'three'
import { mulberry32 } from '../lib/rng'

/**
 * Surfaces shared by every room. Sizes and positions come from the document;
 * what a floor or a wall is does not, because that is a decision about what a
 * library looks like rather than about your library.
 */
export const MATERIALS = {
  /**
   * Limewashed boards rather than plaster: this is a cabin, not a gallery. A
   * shade deeper and warmer than a paint-chip cream, which reads as partition.
   */
  wall: '#d8c4a3',
  /** Skirting in wood, not trim-paint: the wall meets the floor in timber. */
  skirting: '#9a7248',
  /** Exposed rafters and the lintel over an opening. */
  timber: '#6d4b2e',
  carcass: '#8a6039',
  stone: '#948b7c',
  /**
   * Cedar gone grey, which is what a roof in the woods is after a winter. Much
   * darker than the walls, or the building is one blur from across the lake.
   */
  shingle: '#4b4740',
  /** The boards you see under the eaves, looking up from outside. */
  soffit: '#8f6f4c',
} as const

/** One texture tile covers this many metres of floor in each direction. */
const FLOOR_TILE_M = 2.4
/** Board width in metres -- narrow enough to read as flooring, not panelling. */
const PLANK_WIDTH_M = 0.15

/**
 * The three floors, as base colour plus how far the boards vary. Decking is the
 * same drawing with a wider, greyer board and a gap between them, which is what
 * the difference looks like from standing height.
 */
const FINISHES = {
  boards: { r: 146, g: 101, b: 58, plank: PLANK_WIDTH_M, seam: 'rgba(40, 24, 12, 0.5)' },
  deck: { r: 128, g: 110, b: 86, plank: 0.22, seam: 'rgba(30, 24, 16, 0.75)' },
  stone: { r: 150, g: 145, b: 136, plank: 0.6, seam: 'rgba(60, 58, 54, 0.55)' },
  /** Pale spruce for overhead: a cabin ceiling is boards, not plaster. */
  ceiling: { r: 176, g: 142, b: 100, plank: 0.14, seam: 'rgba(62, 42, 24, 0.4)' },
} as const

export type FloorFinishName = keyof typeof FINISHES

/** Drawn into a canvas rather than shipped, which keeps the repo text-only. */
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
 * Near-white streaks multiplied under the material's `color`, so `MATERIALS.wall`
 * stays the one place the tint is decided. Walls are the largest surfaces
 * indoors, and flat fill is what reads as CG. One texture for every room.
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
 * The wall wash's trick for the ground: two-tone grass in neutral greys, tiled.
 * Without it the valley floor is a billiard table no amount of trees makes up for.
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

/**
 * The floor's stroke pass at a fraction of the density, multiplied under each
 * piece's colour. Merged boxes sample the whole tile at their own scale, so the
 * contrast stays low enough to read as tone rather than as planks askew.
 */
let woodGrain: THREE.CanvasTexture | null = null
export function woodGrainTexture(): THREE.CanvasTexture {
  if (woodGrain) return woodGrain
  const size = 256
  const random = mulberry32(0x5eed)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f3f0ea'
  ctx.fillRect(0, 0, size, size)

  // A few soft knots first, so the streaks have something to flow past.
  for (let i = 0; i < 5; i++) {
    const x = random() * size
    const y = random() * size
    const r = 8 + random() * 18
    const knot = ctx.createRadialGradient(x, y, 0, x, y, r)
    knot.addColorStop(0, 'rgba(120, 90, 60, 0.16)')
    knot.addColorStop(0.6, 'rgba(140, 105, 70, 0.06)')
    knot.addColorStop(1, 'rgba(140, 105, 70, 0)')
    ctx.fillStyle = knot
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  ctx.globalAlpha = 0.06
  for (let i = 0; i < 500; i++) {
    const y = random() * size
    const x = random() * size
    const len = 24 + random() * 120
    ctx.strokeStyle = random() > 0.5 ? '#000000' : '#d8a878'
    ctx.lineWidth = 0.5 + random()
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + len, y + (random() - 0.5) * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  woodGrain = new THREE.CanvasTexture(canvas)
  woodGrain.colorSpace = THREE.SRGBColorSpace
  woodGrain.wrapS = THREE.RepeatWrapping
  woodGrain.wrapT = THREE.RepeatWrapping
  return woodGrain
}

/**
 * A low-contrast crosshatch under the cloth colours. Two-pixel threads on
 * purpose: at reading distance they resolve into tooth rather than gingham.
 */
let clothWeave: THREE.CanvasTexture | null = null
export function clothWeaveTexture(): THREE.CanvasTexture {
  if (clothWeave) return clothWeave
  const size = 128
  const random = mulberry32(0xc10c)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f4f2ee'
  ctx.fillRect(0, 0, size, size)

  ctx.globalAlpha = 0.05
  for (let x = 0; x < size; x += 3) {
    ctx.fillStyle = random() > 0.5 ? '#ffffff' : '#b9b2a4'
    ctx.fillRect(x, 0, 2, size)
  }
  for (let y = 0; y < size; y += 3) {
    ctx.fillStyle = random() > 0.5 ? '#ffffff' : '#b9b2a4'
    ctx.fillRect(0, y, size, 2)
  }
  ctx.globalAlpha = 1

  // A few broad blotches so a large cushion is never one flat value.
  for (let i = 0; i < 12; i++) {
    const x = random() * size
    const y = random() * size
    const r = 14 + random() * 34
    const tone = random() > 0.5 ? '255, 255, 255' : '205, 200, 190'
    const blotch = ctx.createRadialGradient(x, y, 0, x, y, r)
    blotch.addColorStop(0, `rgba(${tone}, 0.08)`)
    blotch.addColorStop(1, `rgba(${tone}, 0)`)
    ctx.fillStyle = blotch
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  clothWeave = new THREE.CanvasTexture(canvas)
  clothWeave.colorSpace = THREE.SRGBColorSpace
  clothWeave.wrapS = THREE.RepeatWrapping
  clothWeave.wrapT = THREE.RepeatWrapping
  return clothWeave
}

/**
 * Joint lines and mottle under `MATERIALS.stone`. A hint, not brickwork: the
 * geometry stays slabs, and the joints read only where the light rakes.
 */
let stoneHint: THREE.CanvasTexture | null = null
export function stoneHintTexture(): THREE.CanvasTexture {
  if (stoneHint) return stoneHint
  const size = 256
  const random = mulberry32(0x570e)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f2f1ee'
  ctx.fillRect(0, 0, size, size)

  // Mottle first, joints over it, so the courses stay legible.
  for (let i = 0; i < 40; i++) {
    const x = random() * size
    const y = random() * size
    const r = 12 + random() * 40
    const tone = random() > 0.5 ? '255, 255, 255' : '200, 197, 190'
    const patch = ctx.createRadialGradient(x, y, 0, x, y, r)
    patch.addColorStop(0, `rgba(${tone}, 0.12)`)
    patch.addColorStop(1, `rgba(${tone}, 0)`)
    ctx.fillStyle = patch
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  const course = 48
  ctx.strokeStyle = 'rgba(70, 64, 56, 0.10)'
  ctx.lineWidth = 2
  for (let y = 0; y <= size; y += course) {
    ctx.beginPath()
    ctx.moveTo(0, y + (random() - 0.5) * 3)
    ctx.lineTo(size, y + (random() - 0.5) * 3)
    ctx.stroke()
  }
  for (let row = 0; row < size / course; row++) {
    // Staggered verticals, the running bond.
    let x = -random() * 60
    while (x < size) {
      x += 60 + random() * 70
      ctx.beginPath()
      ctx.moveTo(x, row * course)
      ctx.lineTo(x + (random() - 0.5) * 2, (row + 1) * course)
      ctx.stroke()
    }
  }

  stoneHint = new THREE.CanvasTexture(canvas)
  stoneHint.colorSpace = THREE.SRGBColorSpace
  stoneHint.wrapS = THREE.RepeatWrapping
  stoneHint.wrapT = THREE.RepeatWrapping
  return stoneHint
}

/**
 * A white centre fading to black, read as an alphaMap, so one texture serves
 * every contact shadow at any radius and opacity is the only knob.
 */
let contactShadow: THREE.CanvasTexture | null = null
export function contactShadowTexture(): THREE.CanvasTexture {
  if (contactShadow) return contactShadow
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  const half = size / 2
  const blob = ctx.createRadialGradient(half, half, 0, half, half, half)
  blob.addColorStop(0, 'rgba(255, 255, 255, 1)')
  blob.addColorStop(0.55, 'rgba(255, 255, 255, 0.55)')
  blob.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = blob
  ctx.fillRect(0, 0, size, size)

  contactShadow = new THREE.CanvasTexture(canvas)
  return contactShadow
}
