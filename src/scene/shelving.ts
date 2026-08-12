import { hashId, type BookDimensions } from '../data/dimensions'
import type { Random } from '../lib/rng'
import type { DerivedShelf, DerivedWorld } from '../world/derive'
import { INTERIOR_WIDTH, SHELF, rowMetrics } from '../world/shelf'

/**
 * Turning a saved layout into positions on shelves.
 *
 * The layout stores nothing but an ordered list of book ids per shelf row, keyed
 * by the shelf's *id* rather than its position in the document. That is the
 * whole reason editing `library.json` does not shuffle your library: move a
 * bookcase, reorder the file, insert another one above it — the key is
 * unchanged, so the books stay where you put them. Where each book physically
 * sits is derived by packing its row left to right, so a book that gets fatter
 * after a re-index pushes its neighbours along instead of overlapping them.
 */

export { INTERIOR_WIDTH }
const MARGIN = 0.008

/** `shelfId:row`, the key used in the book layout. Shelf ids may not contain a colon. */
export type RowKey = string

export const rowKey = (shelfId: string, row: number): RowKey => `${shelfId}:${row}`

export function parseRowKey(key: RowKey): { shelfId: string; row: number } | null {
  const split = key.lastIndexOf(':')
  if (split <= 0) return null
  const shelfId = key.slice(0, split)
  const row = Number(key.slice(split + 1))
  if (!Number.isInteger(row) || row < 0) return null
  return { shelfId, row }
}

/** Every row the current world has, in document order. */
export function allRowKeys(world: DerivedWorld): RowKey[] {
  return world.shelves.flatMap((shelf) =>
    Array.from({ length: shelf.rows }, (_, row) => rowKey(shelf.id, row)),
  )
}

export type PackedBook = {
  id: string
  shelfId: string
  /** Index into `world.shelves`, which is what the instanced renderer keys on. */
  shelf: number
  row: number
  /** Centre of the spine along the shelf, in the unit's local frame. */
  localX: number
  localY: number
  localZ: number
  lean: number
}

/** Width a row of these books needs. */
export function widthOf(ids: readonly string[], dims: (id: string) => BookDimensions | undefined) {
  return ids.reduce((total, id) => total + (dims(id)?.thickness ?? 0), 0)
}

export const ROW_CAPACITY = INTERIOR_WIDTH - 2 * MARGIN

export function rowFits(
  ids: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
): boolean {
  return widthOf(ids, dims) <= ROW_CAPACITY
}

/**
 * Positions for one row. Books that do not fit are dropped rather than allowed
 * to spill through the side panel — callers that care where the overflow went
 * (reconciliation does) compare the result against what they passed in.
 */
export function packRow(
  shelf: DerivedShelf,
  shelfIndex: number,
  row: number,
  ids: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
): PackedBook[] {
  const left = -INTERIOR_WIDTH / 2 + MARGIN
  const limit = INTERIOR_WIDTH / 2 - MARGIN
  const surface = rowMetrics(shelf.rows).surfaceY(row)
  const packed: PackedBook[] = []
  let cursor = left

  for (const id of ids) {
    const size = dims(id)
    if (!size) continue
    if (cursor + size.thickness > limit) break

    packed.push({
      id,
      shelfId: shelf.id,
      shelf: shelfIndex,
      row,
      localX: cursor + size.thickness / 2,
      localY: surface + size.height / 2,
      localZ: SHELF.depth / 2 - 0.02 - size.depth / 2,
      lean: size.lean,
    })
    cursor += size.thickness
  }

  // A partly filled row ends with its last book tipped into the gap, the way a
  // real run of books settles when nothing holds it up. The book is also slid
  // along by the base its tilt swings back, so it rests against its neighbour
  // instead of through it. Angle keyed to the book's id: stable, and no two
  // rows lean identically. Visual only — the row's capacity is unchanged.
  const last = packed[packed.length - 1]
  const size = last && dims(last.id)
  if (last && size && packed.length >= 2) {
    const free = limit - cursor
    if (free > 0.055) {
      const tilt = Math.min(0.1 + (hashId(last.id) % 90) / 1000, (free - 0.01) / size.height)
      last.lean = -tilt
      last.localX += Math.sin(tilt) * (size.height / 2)
    }
  }

  return packed
}

export function packLayout(
  world: DerivedWorld,
  rows: Record<RowKey, string[]>,
  dims: (id: string) => BookDimensions | undefined,
): PackedBook[] {
  const packed: PackedBook[] = []
  world.shelves.forEach((shelf, index) => {
    for (let row = 0; row < shelf.rows; row++) {
      packed.push(...packRow(shelf, index, row, rows[rowKey(shelf.id, row)] ?? [], dims))
    }
  })
  return packed
}

/**
 * Add books to the shelves, filling whatever space is left.
 *
 * Takes the rows as they already stand and appends into them, so books added by
 * a later scan land in the gaps rather than being dropped for colliding with an
 * occupied row. Returns the ids it could not place.
 *
 * `order` is which rows to try and in what order, defaulting to the order the
 * document lists them in. Emptying a box passes its own order — see
 * `emptyRowsFirst` — so a boxful lands somewhere in the room rather than
 * always filling the first bookcase by the door.
 */
export function arrangeInto(
  world: DerivedWorld,
  existing: Record<RowKey, string[]>,
  ids: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
  order: readonly RowKey[] = allRowKeys(world),
): { rows: Record<RowKey, string[]>; leftOver: string[] } {
  const rows: Record<RowKey, string[]> = {}
  for (const [key, value] of Object.entries(existing)) rows[key] = [...value]

  // Remaining space in each row, in the order they will be tried.
  const free = order.map((key) => ({ key, used: widthOf(rows[key] ?? [], dims) }))

  const leftOver: string[] = []
  for (const id of ids) {
    const size = dims(id)
    if (!size) {
      // No dimensions means no shelf position; report it unplaced rather than
      // vanishing it — the caller leaves leftOver books where they were.
      leftOver.push(id)
      continue
    }

    // First fit over every row rather than a cursor that only advances: the
    // books arrive in box-stack order, not by thickness, so one fat book must
    // not disqualify a row for every thin one behind it.
    const slot = free.find((row) => row.used + size.thickness <= ROW_CAPACITY)
    if (!slot) {
      leftOver.push(id)
      continue
    }

    ;(rows[slot.key] ??= []).push(id)
    slot.used += size.thickness
  }

  return { rows, leftOver }
}

/**
 * An order to fill rows in that puts the empty ones first, shuffled.
 *
 * Filling in document order would stack a boxful into the first bookcase by
 * the door and leave the rest of the room bare; going to empty shelves first
 * spreads the unpacking around the library the way carrying an armful across
 * the room does. Rows that already hold books come after, in document order,
 * so nothing is dropped for want of a tidy place to go. Unpacking a *box* uses
 * `nearestRowsFirst` instead — the box knows where it is standing.
 *
 * `random` is a seeded generator, so emptying the same box twice does the same
 * thing and a screenshot is reproducible.
 */
export function emptyRowsFirst(
  world: DerivedWorld,
  rows: Record<RowKey, string[]>,
  random: Random,
): RowKey[] {
  const empty: RowKey[] = []
  const used: RowKey[] = []
  for (const key of allRowKeys(world)) {
    if ((rows[key]?.length ?? 0) === 0) empty.push(key)
    else used.push(key)
  }

  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[empty[i], empty[j]] = [empty[j]!, empty[i]!]
  }

  return [...empty, ...used]
}

/**
 * The same order, but from somewhere: empty rows first, nearest bookcase first.
 *
 * This is what unpacking a box uses now that a box can be carried. Carrying it
 * across the room to the case you mean to fill and pressing G should fill *that*
 * case — the seeded shuffle `emptyRowsFirst` does instead scattered the boxful
 * over the whole building, which read as the room ignoring where you were
 * standing. Within a case, rows fill top to bottom; cases at the same distance
 * fall back to document order.
 *
 * The climb to another storey is weighted double, because a case up a flight of
 * stairs is farther than the metres say — a box set down in the loft should
 * fill the loft before it fills the room directly below it.
 */
export function nearestRowsFirst(
  world: DerivedWorld,
  rows: Record<RowKey, string[]>,
  from: { x: number; y: number; z: number },
): RowKey[] {
  const distance = (index: number) => {
    const shelf = world.shelves[index]!
    return Math.hypot(shelf.x - from.x, 2 * (shelf.y - from.y), shelf.z - from.z)
  }
  const byDistance = world.shelves
    .map((_, index) => index)
    .sort((a, b) => distance(a) - distance(b) || a - b)

  const empty: RowKey[] = []
  const used: RowKey[] = []
  for (const index of byDistance) {
    const shelf = world.shelves[index]!
    for (let row = 0; row < shelf.rows; row++) {
      const key = rowKey(shelf.id, row)
      ;((rows[key]?.length ?? 0) === 0 ? empty : used).push(key)
    }
  }
  return [...empty, ...used]
}

/**
 * Where a book aimed at `localX` should be inserted into an already-packed row.
 * Returns an index into the row's id list.
 */
export function insertionIndex(packed: readonly PackedBook[], localX: number): number {
  let index = 0
  for (const book of packed) {
    if (localX < book.localX) break
    index += 1
  }
  return index
}
