import type { BookDimensions } from '../data/dimensions'
import type { DerivedFurniture, DerivedWorld } from './derive'

/**
 * Books lying flat in the moving boxes.
 *
 * Where a book *is* when it has no shelf — which, for a freshly indexed
 * library, is all of them. Stacking them in a box rather than hiding them in a
 * list is the point: a library you have not unpacked should look like one, and
 * the pile should be in your way until you deal with it.
 *
 * A book lies with its spine up: height across the box, depth into it, and
 * thickness stacking vertically.
 */

const WALL = 0.014
/** Books do not stack to the brim; a box you cannot get a hand into is no use. */
const FILL = 0.86

export type BoxedBook = {
  id: string
  boxId: string
  /** World position of the book's centre. */
  x: number
  y: number
  z: number
  rotationY: number
  /** Metres, in the book's own axes: thickness, height, depth. */
  size: [number, number, number]
  colour: string
}

/** What one box is showing of what it holds, so you can page through the rest. */
export type BoxView = {
  /** Index of the first book on show. */
  offset: number
  /** How many are on show from there. */
  shown: number
  /** How many the box holds altogether. */
  total: number
}

export type BoxPacking = {
  placed: BoxedBook[]
  /** Books in a box that the box has no room to show. Still in it, all the same. */
  hidden: string[]
  /** Box id -> which slice of it is visible. */
  views: Record<string, BoxView>
  boxes: number
}

/** The moving boxes in this world, in document order. */
export function boxesIn(world: DerivedWorld): DerivedFurniture[] {
  return world.furniture.filter((item) => item.kind === 'box')
}

/** How many columns of books fit across a box, given a typical book width. */
function columnsIn(box: DerivedFurniture): number {
  const inner = box.depth - 2 * WALL
  // A column is one book deep; two columns front-to-back fit a normal box.
  return Math.max(1, Math.floor(inner / 0.15))
}

/**
 * Stack each box's own books into it, flat, starting a new column when the
 * current one reaches the rim.
 *
 * `contents` is which books are in which box — the same per-box lists the
 * layout stores — so a book you drop into the box by the door is in *that* box
 * and stays there. A box holds more books than it can show: what does not fit
 * comes back as `hidden` rather than being spilled onto the floor or quietly
 * moved somewhere it was not put.
 */
export function packBoxes(
  world: DerivedWorld,
  contents: Record<string, readonly string[]>,
  dims: (id: string) => BookDimensions | undefined,
  offsets: Record<string, number> = {},
): BoxPacking {
  const boxes = boxesIn(world)
  const placed: BoxedBook[] = []
  const hidden: string[] = []
  const views: Record<string, BoxView> = {}

  /** Runs across every box, so neighbouring books never get the same scatter. */
  let nth = 0

  for (const box of boxes) {
    const all = contents[box.id] ?? []
    // Browsing a box is a slice of it: the pile you can see is the top of what
    // it holds, and paging moves the slice rather than the books.
    const offset = Math.max(0, Math.min(Math.floor(offsets[box.id] ?? 0), Math.max(0, all.length - 1)))
    const ids = all.slice(offset)
    const columns = columnsIn(box)
    const ceiling = box.height * FILL
    const inner = box.depth - 2 * WALL
    const spacing = inner / columns
    let cursor = 0

    for (let column = 0; column < columns && cursor < ids.length; column++) {
      // Columns run front to back inside the box, in its own frame.
      const localZ = -inner / 2 + spacing * (column + 0.5)
      let stack = WALL

      while (cursor < ids.length) {
        const id = ids[cursor]!
        const size = dims(id)
        if (!size) {
          cursor += 1
          continue
        }
        if (stack + size.thickness > ceiling) break

        // A little scatter, so a box does not look like a card index.
        const jitter = ((nth * 37) % 11) / 11 - 0.5
        const localX = jitter * 0.05
        const spin = jitter * 0.18

        const cos = Math.cos(box.rotationY)
        const sin = Math.sin(box.rotationY)
        placed.push({
          id,
          boxId: box.id,
          x: box.x + localX * cos + localZ * sin,
          // `box.y` is the floor it stands on — a box carried up to the loft
          // has its pile up there with it.
          y: box.y + stack + size.thickness / 2,
          z: box.z - localX * sin + localZ * cos,
          rotationY: box.rotationY + spin,
          // The book's own axes. It is laid on its side by the renderer, which
          // is what puts its cover up and its printed spine out.
          size: [size.thickness, size.height, size.depth],
          colour: size.colour,
        })
        stack += size.thickness
        cursor += 1
        nth += 1
      }
    }

    hidden.push(...all.slice(0, offset), ...ids.slice(cursor))
    views[box.id] = { offset, shown: cursor, total: all.length }
  }

  return { placed, hidden, views, boxes: boxes.length }
}
