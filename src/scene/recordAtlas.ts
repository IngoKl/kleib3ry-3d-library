import * as THREE from 'three'
import { hashId } from '../data/dimensions'

/**
 * Printed record sleeves, in one texture — the records' answer to the spine
 * atlas. Audio files carry no artwork through the probe (only ID3 text frames
 * are read, to keep the licence surface where it is), so a sleeve is *composed*
 * rather than fetched: a motif and a palette from a hash of the track id, and
 * the album and artist printed on the front. Arbitrary but stable, exactly like
 * a book's cloth colour — the same record always wears the same sleeve.
 *
 * A crate holds a few dozen sleeves, not a few thousand books, so there is no
 * cell recycling: every filed record simply owns a cell, and a collection too
 * big for the grid falls back to plain coloured card past the last cell.
 */

const CELL = 128
const COLUMNS = 12
const ROWS = 12

export const SLOT_COUNT = COLUMNS * ROWS
const BLANK_SLOT = 0
export const FIRST_ASSIGNABLE = 1
export const ASSIGNABLE_SLOTS = SLOT_COUNT - 1

export type SleeveArt = {
  /** What the sleeve says — the album if the tags name one, else the title. */
  title: string
  artist: string | null
  colour: string
  /** Stable per-track hash; picks the motif and its variation. */
  seed: number
}

const SLEEVE_COLOURS = [
  '#2f4257', '#6b2f3c', '#3f5a4a', '#8c5a2b', '#4a4038', '#5a3a55',
  '#334a52', '#7a6a44', '#775241', '#2b3a45', '#8d6b52', '#43506b',
]

/** The one sleeve a track ever wears, wherever it is drawn. */
export function sleeveArtFor(track: {
  id: string
  title: string
  artist: string | null
  album: string | null
}): SleeveArt {
  const seed = hashId(track.id)
  return {
    title: track.album ?? track.title,
    artist: track.artist,
    colour: SLEEVE_COLOURS[seed % SLEEVE_COLOURS.length]!,
    seed,
  }
}

/**
 * Where each face of a sleeve reads from, as a fraction of its cell. The front
 * face takes the whole cell; every other face samples a single point inside the
 * painted edge band, so the thin sides read as the sleeve's darker card.
 */
export const SLEEVE_REGIONS = {
  front: [0, 0, 1, 1] as const,
  edge: [0.012, 0.5] as const,
}

function shade(colour: THREE.Color, amount: number): string {
  const c = colour.clone()
  if (amount < 0) c.multiplyScalar(1 + amount)
  else c.lerp(new THREE.Color(1, 1, 1), amount)
  return `#${c.getHexString()}`
}

function inkFor(colour: THREE.Color): string {
  const luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
  return luminance > 0.55 ? '#241c14' : '#f1e6cf'
}

/**
 * Paint one sleeve into a square of any size. Shared between the atlas cells
 * and the full-resolution textures for the sleeve in hand and on the deck, so
 * the record you are carrying is recognisably the one you took out.
 */
export function drawSleeve(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  art: SleeveArt,
): void {
  const colour = new THREE.Color(art.colour)
  const ink = inkFor(colour)
  const s = size

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, s, s)
  ctx.clip()

  // The edge band first: it is both the border of the front and the colour
  // every thin face of the box samples.
  ctx.fillStyle = shade(colour, -0.4)
  ctx.fillRect(x, y, s, s)
  const inset = Math.max(1, s * 0.03)
  ctx.fillStyle = art.colour
  ctx.fillRect(x + inset, y + inset, s - 2 * inset, s - 2 * inset)

  // A motif, from the same hash that chose the colour. Bold shapes on purpose:
  // a sleeve is read across a room, not held to the nose.
  ctx.save()
  ctx.beginPath()
  ctx.rect(x + inset, y + inset, s - 2 * inset, s - 2 * inset)
  ctx.clip()
  const lighter = shade(colour, 0.28)
  const darker = shade(colour, -0.25)
  switch (art.seed % 5) {
    case 0: {
      // A big off-centre disc — the record showing through.
      ctx.fillStyle = darker
      ctx.beginPath()
      ctx.arc(x + s * 0.62, y + s * 0.42, s * 0.34, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = lighter
      ctx.beginPath()
      ctx.arc(x + s * 0.62, y + s * 0.42, s * 0.12, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 1: {
      // Horizontal bands.
      ctx.fillStyle = lighter
      for (let i = 0; i < 3; i++) ctx.fillRect(x, y + s * (0.14 + i * 0.18), s, s * 0.07)
      break
    }
    case 2: {
      // A diagonal split.
      ctx.fillStyle = darker
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + s, y)
      ctx.lineTo(x, y + s * 0.85)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = lighter
      ctx.lineWidth = Math.max(1, s * 0.02)
      ctx.beginPath()
      ctx.moveTo(x + s, y)
      ctx.lineTo(x, y + s * 0.85)
      ctx.stroke()
      break
    }
    case 3: {
      // Quarter sunrise from a corner.
      for (let i = 4; i >= 1; i--) {
        ctx.fillStyle = i % 2 ? lighter : darker
        ctx.beginPath()
        ctx.moveTo(x, y + s)
        ctx.arc(x, y + s, s * 0.22 * i, -Math.PI / 2, 0)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    default: {
      // Two stacked blocks.
      ctx.fillStyle = darker
      ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.36, s * 0.52)
      ctx.fillStyle = lighter
      ctx.fillRect(x + s * 0.54, y + s * 0.22, s * 0.36, s * 0.4)
      break
    }
  }
  ctx.restore()

  // The label: album along the bottom, artist under it. Shrink to fit, then
  // clip — a squeezed name still says which record this is.
  const pad = s * 0.07
  const available = s - 2 * pad
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink

  let fontSize = s * 0.11
  for (; fontSize > s * 0.055; fontSize -= 1) {
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`
    if (ctx.measureText(art.title).width <= available) break
  }
  ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`
  ctx.fillText(art.title, x + pad, y + s * 0.82, available)

  if (art.artist) {
    ctx.font = `400 ${Math.max(s * 0.055, fontSize * 0.72)}px "Segoe UI", system-ui, sans-serif`
    ctx.globalAlpha = 0.85
    ctx.fillText(art.artist, x + pad, y + s * 0.92, available)
    ctx.globalAlpha = 1
  }

  ctx.restore()
}

/** A one-off full-resolution sleeve, for the record in hand or on the deck. */
export function makeSleeveTexture(art: SleeveArt, resolution = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = resolution
  canvas.height = resolution
  const ctx = canvas.getContext('2d')!
  drawSleeve(ctx, 0, 0, resolution, art)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export type SleeveAtlas = {
  texture: THREE.CanvasTexture
  rect(slot: number): [number, number, number, number]
  blank: [number, number, number, number]
  draw(slot: number, art: SleeveArt): void
  commit(): void
  dispose(): void
}

export function makeSleeveAtlas(): SleeveAtlas {
  const canvas = document.createElement('canvas')
  canvas.width = COLUMNS * CELL
  canvas.height = ROWS * CELL
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true

  let pending = false

  const originOf = (slot: number) => ({
    x: (slot % COLUMNS) * CELL,
    y: Math.floor(slot / COLUMNS) * CELL,
  })

  const rect = (slot: number): [number, number, number, number] => {
    const { x, y } = originOf(slot)
    const bleed = 0.5
    return [
      (x + bleed) / canvas.width,
      1 - (y + CELL - bleed) / canvas.height,
      (CELL - 2 * bleed) / canvas.width,
      (CELL - 2 * bleed) / canvas.height,
    ]
  }

  return {
    texture,
    rect,
    blank: rect(BLANK_SLOT),
    draw: (slot, art) => {
      if (slot === BLANK_SLOT) return
      const { x, y } = originOf(slot)
      drawSleeve(ctx, x, y, CELL, art)
      pending = true
    },
    commit: () => {
      if (!pending) return
      texture.needsUpdate = true
      pending = false
    },
    dispose: () => texture.dispose(),
  }
}

/**
 * A unit cube whose front (+Z) face carries the whole atlas cell and whose
 * every other face samples the painted edge band — mirrored album titles on
 * the back of a sleeve would give the trick away.
 */
export function makeSleeveGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, SLEEVE_REGIONS.edge[0], SLEEVE_REGIONS.edge[1])
  }
  // BoxGeometry emits +X, -X, +Y, -Y, +Z, -Z, four vertices each; +Z (16..19)
  // is the face a filed record shows the room.
  const box = new THREE.BoxGeometry(1, 1, 1)
  const source = box.attributes.uv as THREE.BufferAttribute
  const [rx, ry, rw, rh] = SLEEVE_REGIONS.front
  for (let i = 16; i < 20; i++) {
    uv.setXY(i, rx + source.getX(i) * rw, ry + source.getY(i) * rh)
  }
  box.dispose()
  uv.needsUpdate = true
  return geometry
}

/** The atlas sampled through a per-instance rectangle — same trick as the books. */
export function makeSleeveMaterial(atlas: SleeveAtlas): THREE.MeshStandardMaterial {
  const created = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 })
  created.map = atlas.texture
  created.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aUvRect;\nvarying vec2 vAtlasUv;',
      )
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\nvAtlasUv = aUvRect.xy + uv * aUvRect.zw;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAtlasUv;')
      .replace('#include <map_fragment>', 'diffuseColor *= texture2D( map, vAtlasUv );')
  }
  return created
}
