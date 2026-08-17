import { aabbFromCentre } from '../scene/collision'
import type { DerivedShelf, Solid } from './derive'

/**
 * The bookcase. Proportions are fixed; where it stands and how many shelves it
 * holds come from the document. Everything is about a quarter over life size,
 * because a spine read from across a room is only legible if the book is big.
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
 * Compartment geometry for a case with `rows` shelves. Packing, aiming and the
 * carcass mesh all ask here rather than assuming a row count.
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

/** A case blocks you only on its own floor: one in the loft is not a wall below. */
export function shelfColliders(shelves: readonly DerivedShelf[]): Solid[] {
  return shelves.map((shelf) => ({
    ...aabbFromCentre(shelf.x, shelf.z, SHELF.width, SHELF.depth, shelf.rotationY),
    bottom: shelf.y,
    top: shelf.y + SHELF.height,
  }))
}
