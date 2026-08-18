import * as THREE from 'three'

/**
 * Printed spines and covers in one texture, so the library stays one draw call.
 * Cells are recycled nearest-first, and a book with no cell falls back to plain
 * cloth — which is what everything past four metres is anyway.
 */

/**
 * One book per cell: a spine strip down the left, its cover on the right. Both
 * share a cell because an instance carries a single UV rectangle.
 *
 * BUDGET: the atlas re-uploads whole whenever any cell changes, so its size is a
 * per-pass cost. ~15 MB is what the frame times carry; 23 MB timed out
 * Playwright on the software rasteriser. Keep the product of the two here.
 */
const CELL_W = 176
const CELL_H = 240

/** The spine strip, down the left-hand edge of the cell. */
const SPINE_W = 52
/** Board-shaped and pushed to the cell's edges: margin here is wasted resolution. */
const COVER_X = 56
const COVER_W = 116
const COVER_Y = 28
const COVER_H = 182

/**
 * A parameter because `Tapes` shares this machinery with a much smaller grid: a
 * dozen cassettes must not allocate a second 15 MB texture.
 */
export type AtlasGrid = { columns: number; rows: number }

/** 88 cells at ~15 MB. See the budget note above before changing either. */
const BOOK_GRID: AtlasGrid = { columns: 11, rows: 8 }

export const SLOT_COUNT = BOOK_GRID.columns * BOOK_GRID.rows

/** Plain white, so an unslotted instance pointing at it keeps its own colour. */
const BLANK_SLOT = 0

export type SpineArt = {
  title: string
  author: string | null
  colour: string
  /** Metres. Decides how much room there is to print anything. */
  thickness: number
  /** The real cover, if it has been fetched. Drawn onto the front board. */
  cover: HTMLImageElement | null
}

/** Baked into the geometry; the per-instance rectangle then places them in the atlas. */
export const CELL_REGIONS = {
  spine: [0, 0, SPINE_W / CELL_W, 1] as const,
  cover: [
    COVER_X / CELL_W,
    COVER_Y / CELL_H,
    COVER_W / CELL_W,
    COVER_H / CELL_H,
  ] as const,
  /** A point that is always plain cloth, for the faces nobody sees. */
  cloth: [6 / CELL_W, 0.5] as const,
}

export type SpineAtlas = {
  texture: THREE.CanvasTexture
  /** How many cells this atlas can hand out, i.e. everything but the blank one. */
  assignable: number
  /** The UV rectangle for a slot, as `[x, y, width, height]`. */
  rect(slot: number): [number, number, number, number]
  blank: [number, number, number, number]
  draw(slot: number, art: SpineArt): void
  /** Separate from `draw` because a dirty texture re-uploads whole: batch, or pay per cell. */
  commit(): void
  dispose(): void
}

/** Slightly darker and lighter versions of a colour, for bands and edges. */
function shade(colour: THREE.Color, amount: number): string {
  const c = colour.clone()
  if (amount < 0) c.multiplyScalar(1 + amount)
  else c.lerp(new THREE.Color(1, 1, 1), amount)
  return `#${c.getHexString()}`
}

/** Light ink on dark cloth, dark ink on light — whichever will actually read. */
function inkFor(colour: THREE.Color): string {
  const luminance = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b
  return luminance > 0.55 ? '#241c14' : '#f1e6cf'
}

export function makeBookAtlas(grid: AtlasGrid = BOOK_GRID): SpineAtlas {
  const canvas = document.createElement('canvas')
  canvas.width = grid.columns * CELL_W
  canvas.height = grid.rows * CELL_H
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true

  /** Whether any cell has been redrawn since the last upload. */
  let pending = false

  const originOf = (slot: number) => ({
    x: (slot % grid.columns) * CELL_W,
    y: Math.floor(slot / grid.columns) * CELL_H,
  })

  const rect = (slot: number): [number, number, number, number] => {
    const { x, y } = originOf(slot)
    // Inset half a texel: at grazing angles mipmapping bleeds neighbouring cells.
    const bleed = 0.5
    return [
      (x + bleed) / canvas.width,
      1 - (y + CELL_H - bleed) / canvas.height,
      (CELL_W - 2 * bleed) / canvas.width,
      (CELL_H - 2 * bleed) / canvas.height,
    ]
  }

  const draw = (slot: number, art: SpineArt) => {
    if (slot === BLANK_SLOT) return
    const { x, y } = originOf(slot)
    const colour = new THREE.Color(art.colour)
    const ink = inkFor(colour)

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, CELL_W, CELL_H)
    ctx.clip()

    ctx.fillStyle = art.colour
    ctx.fillRect(x, y, CELL_W, CELL_H)

    // ---- the cover panel ----
    if (art.cover) {
      // Cover art is not board-shaped: fill and crop rather than squash.
      const scale = Math.max(COVER_W / art.cover.width, COVER_H / art.cover.height)
      const w = art.cover.width * scale
      const h = art.cover.height * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(x + COVER_X, y + COVER_Y, COVER_W, COVER_H)
      ctx.clip()
      ctx.drawImage(
        art.cover,
        x + COVER_X + (COVER_W - w) / 2,
        y + COVER_Y + (COVER_H - h) / 2,
        w,
        h,
      )
      ctx.restore()
    }
    // The board stands proud of the pages, so the page edges show.
    ctx.fillStyle = '#e9e0cb'
    ctx.fillRect(x + COVER_X + COVER_W, y + COVER_Y + 4, 4, COVER_H - 8)

    // Rounded shoulders faked with a gradient rather than geometry.
    const shading = ctx.createLinearGradient(x, y, x + SPINE_W, y)
    shading.addColorStop(0, 'rgba(0,0,0,0.34)')
    shading.addColorStop(0.28, 'rgba(255,255,255,0.07)')
    shading.addColorStop(0.72, 'rgba(255,255,255,0.04)')
    shading.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = shading
    ctx.fillRect(x, y, SPINE_W, CELL_H)

    // Head and tail bands, as most cloth bindings have.
    ctx.fillStyle = shade(colour, -0.35)
    ctx.fillRect(x, y + CELL_H * 0.11, SPINE_W, 4)
    ctx.fillRect(x, y + CELL_H * 0.82, SPINE_W, 4)
    ctx.fillStyle = shade(colour, 0.22)
    ctx.fillRect(x, y + CELL_H * 0.115, SPINE_W, 2)
    ctx.fillRect(x, y + CELL_H * 0.825, SPINE_W, 2)

    // Text runs up the spine, which is how a spine is read on a shelf.
    ctx.beginPath()
    ctx.rect(x, y, SPINE_W, CELL_H)
    ctx.clip()
    ctx.translate(x + SPINE_W / 2, y + CELL_H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink

    // A narrow spine cannot carry much. Shrink to fit, then clip: a squeezed
    // title still identifies the book, a missing one does not.
    const available = CELL_H * 0.62
    const title = art.title
    let fontSize = Math.min(25, Math.max(12, art.thickness * 910))
    for (; fontSize > 10; fontSize -= 1) {
      ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`
      if (ctx.measureText(title).width <= available) break
    }
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(title, -CELL_H * 0.04, 0, available)

    if (art.author && art.thickness > 0.014) {
      ctx.font = `400 ${Math.max(10, fontSize - 6)}px "Segoe UI", system-ui, sans-serif`
      ctx.globalAlpha = 0.82
      ctx.fillText(art.author, CELL_H * 0.31, 0, CELL_H * 0.22)
      ctx.globalAlpha = 1
    }

    ctx.restore()
    pending = true
  }

  return {
    texture,
    assignable: grid.columns * grid.rows - 1,
    rect,
    blank: rect(BLANK_SLOT),
    draw,
    commit: () => {
      if (!pending) return
      texture.needsUpdate = true
      pending = false
    },
    dispose: () => texture.dispose(),
  }
}

/** Assignable slots, i.e. everything but the blank one. */
export const ASSIGNABLE_SLOTS = SLOT_COUNT - 1
export const FIRST_ASSIGNABLE = 1
