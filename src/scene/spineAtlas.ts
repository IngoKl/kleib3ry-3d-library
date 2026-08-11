import * as THREE from 'three'

/**
 * Printed spines, in one texture.
 *
 * A shelved book used to be a coloured box with, for the nearest few dozen, an
 * SDF label floating in front of it — one draw call each, so the budget capped
 * it at 48 and everything else was anonymous cloth. Here the artwork is drawn
 * into cells of a single atlas and each instance is told which cell is its own,
 * so the whole library keeps its one draw call and hundreds of books can be
 * genuinely legible at once.
 *
 * Cells are recycled: only the books near enough to read get one, and a cell is
 * redrawn when it is reassigned. Walking down a shelf therefore costs a handful
 * of 2D canvas draws per second, not a re-render of anything.
 */

/**
 * Each cell holds one book: a spine strip down the left, and its cover on the
 * right.
 *
 * Both live in the same cell because an instance carries a single UV rectangle,
 * so the two faces are told apart by the *geometry's* uvs, which pick out a
 * region of whichever cell the instance points at. That is what lets a shelved
 * book be a real book — cover on the front board, printed spine on the spine —
 * while the whole library stays one draw call.
 *
 * The atlas is re-uploaded whenever any cell changes, so its size is a direct
 * cost while you walk into a new shelf; 144 cells at this resolution is ~15 MB.
 */
const CELL_W = 128
const CELL_H = 208
const COLUMNS = 12
const ROWS = 12

/** The spine strip, down the left-hand edge of the cell. */
const SPINE_W = 40
/** The cover panel. Its proportions match a board — depth by height. */
const COVER_X = 44
const COVER_W = 80
const COVER_Y = 36
const COVER_H = 136

export const SLOT_COUNT = COLUMNS * ROWS

/**
 * The first cell is never assigned to a book: it is plain white, and every
 * unslotted instance points at it so its own instance colour shows through
 * unchanged. That is what lets far-away books stay flat cloth for free.
 */
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

/**
 * Where each face of a book reads from, as a fraction of its cell. The geometry
 * bakes these in; the per-instance rectangle then places them in the atlas.
 */
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
  /** The UV rectangle for a slot, as `[x, y, width, height]`. */
  rect(slot: number): [number, number, number, number]
  blank: [number, number, number, number]
  draw(slot: number, art: SpineArt): void
  /**
   * Upload the cells drawn since the last call.
   *
   * Separate from `draw` on purpose: marking the texture dirty re-uploads the
   * whole atlas, so doing it per cell meant sending twelve megabytes to the GPU
   * a couple of dozen times per pass. Once per batch is once per pass.
   */
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

export function makeBookAtlas(): SpineAtlas {
  const canvas = document.createElement('canvas')
  canvas.width = COLUMNS * CELL_W
  canvas.height = ROWS * CELL_H
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
    x: (slot % COLUMNS) * CELL_W,
    y: Math.floor(slot / COLUMNS) * CELL_H,
  })

  const rect = (slot: number): [number, number, number, number] => {
    const { x, y } = originOf(slot)
    // Inset by half a texel so a cell never bleeds into its neighbour when the
    // spine is seen at a grazing angle and mipmapping kicks in.
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
      // Cover art is not board-shaped; fill the board and crop rather than
      // squashing somebody's typography.
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
    // A board is proud of its pages on three edges, and the pages show.
    ctx.fillStyle = '#e9e0cb'
    ctx.fillRect(x + COVER_X + COVER_W, y + COVER_Y + 3, 3, COVER_H - 6)

    // The rounded shoulders of a bound spine, faked with two gradients rather
    // than geometry: the box stays a box, but it stops reading as flat.
    const shading = ctx.createLinearGradient(x, y, x + SPINE_W, y)
    shading.addColorStop(0, 'rgba(0,0,0,0.34)')
    shading.addColorStop(0.28, 'rgba(255,255,255,0.07)')
    shading.addColorStop(0.72, 'rgba(255,255,255,0.04)')
    shading.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = shading
    ctx.fillRect(x, y, SPINE_W, CELL_H)

    // Head and tail bands, as most cloth bindings have.
    ctx.fillStyle = shade(colour, -0.35)
    ctx.fillRect(x, y + CELL_H * 0.11, SPINE_W, 3)
    ctx.fillRect(x, y + CELL_H * 0.82, SPINE_W, 3)
    ctx.fillStyle = shade(colour, 0.22)
    ctx.fillRect(x, y + CELL_H * 0.115, SPINE_W, 1)
    ctx.fillRect(x, y + CELL_H * 0.825, SPINE_W, 1)

    // Text runs up the spine, which is how a spine is read on a shelf.
    ctx.beginPath()
    ctx.rect(x, y, SPINE_W, CELL_H)
    ctx.clip()
    ctx.translate(x + SPINE_W / 2, y + CELL_H / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink

    // A narrow spine cannot carry much. Shrink to fit, then give up and clip:
    // a squeezed title still tells you which book it is, a missing one does not.
    const available = CELL_H * 0.62
    const title = art.title
    let fontSize = Math.min(19, Math.max(9, art.thickness * 700))
    for (; fontSize > 8; fontSize -= 1) {
      ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`
      if (ctx.measureText(title).width <= available) break
    }
    ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(title, -CELL_H * 0.04, 0, available)

    if (art.author && art.thickness > 0.014) {
      ctx.font = `400 ${Math.max(8, fontSize - 5)}px "Segoe UI", system-ui, sans-serif`
      ctx.globalAlpha = 0.82
      ctx.fillText(art.author, CELL_H * 0.31, 0, CELL_H * 0.22)
      ctx.globalAlpha = 1
    }

    ctx.restore()
    pending = true
  }

  return {
    texture,
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
