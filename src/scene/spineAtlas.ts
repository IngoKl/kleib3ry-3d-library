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
 * The atlas is re-uploaded whenever any cell changes, so its *total size* is a
 * per-pass cost while you walk into a new shelf — and that total is the budget
 * everything else here is spent out of. It is fixed at about 15 MB, which is
 * what the frame times will carry: a first attempt at sharper covers took it to
 * 23 MB and the headless renderer, which uploads textures on the CPU, spent long
 * enough per pass that Playwright's own clicks started timing out.
 *
 * Inside that budget, cell size trades against cell count, and the trade was
 * re-struck once in favour of size. A cover used to get 80x136 px of a 128x208
 * cell, which at the distance you are at when you draw a book out with `F` to
 * look at it was visibly a thumbnail. It now gets 116x182 of a 176x240 cell:
 * 1.9x the pixels, with the spine 1.5x. Some of that came free — the old cell
 * was 28% margin — and the rest is paid for in cells, 88 rather than 143.
 *
 * Cells are the right thing to spend: they are handed out nearest-first, so
 * losing some costs legibility at the *back* of what you can read, and a book
 * with no cell goes back to plain cloth, which is what everything past four
 * metres already is.
 */
const CELL_W = 176
const CELL_H = 240

/** The spine strip, down the left-hand edge of the cell. */
const SPINE_W = 52
/**
 * The cover panel. Its proportions match a board — depth by height — and it is
 * pushed out to the edges of what the cell has left, because every pixel of
 * margin here is a pixel of somebody's cover thrown away.
 */
const COVER_X = 56
const COVER_W = 116
const COVER_Y = 28
const COVER_H = 182

/**
 * How many cells an atlas is cut into.
 *
 * A parameter rather than a constant because the shelves are not the only thing
 * printed through here: a VHS cassette is a thin box with a printed spine and a
 * label on one face, which is exactly what this draws, so `Tapes` shares the
 * whole machinery — and a crate of a dozen tapes wants sixteen cells, not
 * eighty-eight. Giving it the book grid meant a second 15 MB texture uploaded
 * for twelve cassettes, which is how the frame budget was found.
 */
export type AtlasGrid = { columns: number; rows: number }

/** 88 cells at ~15 MB. See the note above for what fixes both numbers. */
const BOOK_GRID: AtlasGrid = { columns: 11, rows: 8 }

export const SLOT_COUNT = BOOK_GRID.columns * BOOK_GRID.rows

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
  /** How many cells this atlas can hand out, i.e. everything but the blank one. */
  assignable: number
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
    ctx.fillRect(x + COVER_X + COVER_W, y + COVER_Y + 4, 4, COVER_H - 8)

    // The rounded shoulders of a bound spine, faked with two gradients rather
    // than geometry: the box stays a box, but it stops reading as flat.
    const shading = ctx.createLinearGradient(x, y, x + SPINE_W, y)
    shading.addColorStop(0, 'rgba(0,0,0,0.34)')
    shading.addColorStop(0.28, 'rgba(255,255,255,0.07)')
    shading.addColorStop(0.72, 'rgba(255,255,255,0.04)')
    shading.addColorStop(1, 'rgba(0,0,0,0.34)')
    ctx.fillStyle = shading
    ctx.fillRect(x, y, SPINE_W, CELL_H)

    // Head and tail bands, as most cloth bindings have. In pixels rather than
    // fractions, and so scaled with the cell when it grew.
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

    // A narrow spine cannot carry much. Shrink to fit, then give up and clip:
    // a squeezed title still tells you which book it is, a missing one does not.
    const available = CELL_H * 0.62
    const title = art.title
    // Scaled with the strip: the cap and the floor are both about 1.4x what they
    // were, which is the ratio the spine grew by, so a title that just fitted
    // still just fits and everything is drawn larger.
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
