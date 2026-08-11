import { aabbFromCentre } from '../scene/collision'
import type { DerivedShelf, Solid } from './derive'

/**
 * The bookcase itself. Its *proportions* are fixed — a bookcase is a bookcase —
 * while where it stands and how many shelves it holds come from the world
 * document, because those are the things worth deciding per library.
 *
 * The carcass grew with the books. A spine is read at two or three metres
 * across a room, and at the old scale the printed title was a few pixels tall
 * even with a whole atlas cell to itself; making the books physically larger is
 * the only thing that actually buys legibility, and the case has to hold them.
 */
export const SHELF = {
  width: 1.0,
  depth: 0.32,
  height: 2.24,
  panel: 0.022,
  board: 0.024,
  back: 0.01,
  plinth: 0.08,
} as const

/** Stand-off from the wall face, for placing units in the document. */
export const SHELF_CLEARANCE = SHELF.depth / 2 + 0.015

const LOWEST_SURFACE = SHELF.plinth + SHELF.board
const USABLE_HEIGHT = SHELF.height - SHELF.board - LOWEST_SURFACE

/**
 * Compartment geometry for a case with `rows` shelves. A four-row case has
 * taller compartments than a six-row one; everything downstream — packing,
 * aiming, the carcass mesh — asks here rather than assuming five.
 */
export function rowMetrics(rows: number) {
  const rowHeight = (USABLE_HEIGHT - (rows - 1) * SHELF.board) / rows
  return {
    rows,
    rowHeight,
    /** Height of the surface the books in `row` stand on, from the floor. */
    surfaceY: (row: number) => LOWEST_SURFACE + row * (rowHeight + SHELF.board),
  }
}

/** Which compartment a point at height `localY` is in, or null if none. */
export function rowFromLocalY(localY: number, rows: number): number | null {
  const { rowHeight, surfaceY } = rowMetrics(rows)
  for (let row = 0; row < rows; row++) {
    const bottom = surfaceY(row)
    if (localY >= bottom - SHELF.board && localY <= bottom + rowHeight) return row
  }
  return null
}

/** Usable width inside one compartment. */
export const INTERIOR_WIDTH = SHELF.width - 2 * SHELF.panel

/**
 * A bookcase blocks you on the floor it stands on, and only there — a case in
 * the loft is not a wall in the living room below it.
 */
export function shelfColliders(shelves: readonly DerivedShelf[]): Solid[] {
  return shelves.map((shelf) => ({
    ...aabbFromCentre(shelf.x, shelf.z, SHELF.width, SHELF.depth, shelf.rotationY),
    bottom: shelf.y,
    top: shelf.y + SHELF.height,
  }))
}
