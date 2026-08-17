import { hashId, type BookDimensions } from '../data/dimensions'
import type { Random } from '../lib/rng'
import type { DerivedShelf, DerivedWorld } from '../world/derive'
import { INTERIOR_WIDTH, SHELF, rowMetrics } from '../world/shelf'

/**
 * Turning a saved layout into positions on shelves. The layout is an ordered
 * list of book ids per row, keyed by shelf id rather than document position,
 * which is why editing `library.json` never shuffles a library. Position is
 * derived by packing left to right, so a book that gets fatter after a re-index
 * pushes its neighbours along instead of overlapping them.
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

/** The steepest a row ever leans, in radians — about eight degrees. */
const SETTLE_MAX = 0.145

export function rowFits(
  ids: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
): boolean {
  return widthOf(ids, dims) <= ROW_CAPACITY
}

/**
 * Positions for one row. Books that do not fit are dropped rather than spilling
 * through the side panel; callers that care compare the result to their input.
 */
export function packRow(
  shelf: DerivedShelf,
  shelfIndex: number,
  row: number,
  ids: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
  /** False stands every book plumb: a setting, because it is taste. */
  settle = true,
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
      lean: 0,
    })
    cursor += size.thickness
  }

  // A slack row leans back, the whole run tipping towards the closed end until
  // its innermost spine rests on the side panel. Sheared as one, so every spine
  // stays in face contact with the next; tipping books individually opens a
  // wedge of air between them, which is the artefact this exists to avoid.
  //
  // The angle is what the slack allows, up to `SETTLE_MAX`, and is keyed to the
  // row rather than the book, so one more book does not re-pitch the shelf.
  const free = limit - cursor
  if (settle && packed.length > 0 && free > 0.008) {
    // The innermost book's top corner is what meets the panel, so its height is
    // what decides how far the run can slide before it does.
    const reach = dims(packed[0]!.id)!.height
    const wanted = SETTLE_MAX * (0.55 + (hashId(rowKey(shelf.id, row)) % 45) / 100)
    const tilt = Math.min(wanted, Math.asin(Math.min(1, (free - 0.004) / reach)))
    if (tilt > 0.02) {
      const slide = Math.sin(tilt) * reach
      for (const item of packed) {
        const size = dims(item.id)!
        item.lean = tilt
        // The instance turns about the book's centre, swinging its foot the
        // other way; taking that back off keeps the run flush along the shelf.
        item.localX += slide - Math.sin(tilt) * (size.height / 2)
      }
    }
  }

  return packed
}

export function packLayout(
  world: DerivedWorld,
  rows: Record<RowKey, string[]>,
  dims: (id: string) => BookDimensions | undefined,
  settle = true,
): PackedBook[] {
  const packed: PackedBook[] = []
  world.shelves.forEach((shelf, index) => {
    for (let row = 0; row < shelf.rows; row++) {
      packed.push(...packRow(shelf, index, row, rows[rowKey(shelf.id, row)] ?? [], dims, settle))
    }
  })
  return packed
}

/**
 * Append into the rows as they already stand, so a later scan's books land in
 * the gaps rather than being dropped for colliding with an occupied row.
 * Returns the ids it could not place.
 *
 * `order` is which rows to try, defaulting to document order; emptying a box
 * passes its own so a boxful does not always fill the first case by the door.
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

    // First fit over every row rather than an advancing cursor: books arrive in
    // stack order, so one fat book must not disqualify a row for the thin ones.
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
 * Empty rows first, shuffled, so unpacking spreads round the library instead of
 * stacking a boxful into the first case by the door. Occupied rows come after in
 * document order, so nothing is dropped for want of a tidy place to go.
 *
 * `random` is seeded, so emptying the same box twice does the same thing.
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
 * The same order, but from somewhere: empty rows first, nearest case first, so
 * carrying a box to the case you mean to fill and pressing G fills that one.
 * Rows within a case go top to bottom; ties fall back to document order.
 *
 * A storey costs double, because a case up a flight is farther than the metres
 * say — a box in the loft should fill the loft before the room below it.
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
