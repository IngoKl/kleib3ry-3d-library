import { expect, test } from '@playwright/test'
import { aabbFromCentre, blocked, overlapsCircle, resolveMove } from '../src/scene/collision'
import { SHELF, rowFromLocalY, rowMetrics, shelfColliders } from '../src/world/shelf'
import {
  INTERIOR_WIDTH,
  allRowKeys,
  arrangeInto,
  insertionIndex,
  packRow,
  parseRowKey,
  rowFits,
  rowKey,
} from '../src/scene/shelving'
import { dimensionsFor, hashId } from '../src/data/dimensions'
import { deriveWorld } from '../src/world/derive'
import { parseWorldText } from '../src/world/schema'
import { DEFAULT_WORLD_TEXT } from '../src/world/defaults'
import type { IndexedBook } from '../src/services/types'

/** The world every test below is measured against: the one people actually get. */
const WORLD = deriveWorld(parseWorldText(DEFAULT_WORLD_TEXT))
const SHELF_0 = WORLD.shelves[0]!
const ROW_HEIGHT = rowMetrics(SHELF_0.rows).rowHeight

const box = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }

test.describe('collision', () => {
  test('a circle only overlaps once its radius reaches the box', () => {
    expect(overlapsCircle(box, { x: 1.4, z: 0 }, 0.3)).toBe(false)
    expect(overlapsCircle(box, { x: 1.2, z: 0 }, 0.3)).toBe(true)
  })

  test('walking straight into a wall stops the move', () => {
    expect(resolveMove({ x: 2, z: 0 }, { x: 1.1, z: 0 }, 0.3, [box])).toEqual({ x: 2, z: 0 })
  })

  test('walking into a wall at an angle slides along it', () => {
    const to = resolveMove({ x: 2, z: 0 }, { x: 1.1, z: 0.5 }, 0.3, [box])
    expect(to.x).toBe(2)
    expect(to.z).toBeCloseTo(0.5)
  })

  test('starting inside a box does not trap the player', () => {
    expect(resolveMove({ x: 0, z: 0 }, { x: 0.4, z: 0.2 }, 0.3, [box])).toEqual({ x: 0.4, z: 0.2 })
  })

  test('a quarter turn swaps the footprint extents', () => {
    expect(aabbFromCentre(0, 0, 2, 1, 0)).toEqual({ minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 })
    expect(aabbFromCentre(0, 0, 2, 1, Math.PI / 2)).toEqual({
      minX: -0.5,
      maxX: 0.5,
      minZ: -1,
      maxZ: 1,
    })
  })

  test('nothing is sitting on the player spawn', () => {
    const colliders = [...WORLD.colliders, ...shelfColliders(WORLD.shelves)]
    expect(blocked(colliders, { x: WORLD.spawn.x, z: WORLD.spawn.z }, 0.28)).toBe(false)
  })
})

// --- shelving ---------------------------------------------------------

function book(id: string, over: Partial<IndexedBook> = {}): IndexedBook {
  return {
    id,
    path: `C:\\books\\${id}.pdf`,
    format: 'pdf',
    title: `Book ${id}`,
    author: 'A. Writer',
    cover: null,
    pageCount: 300,
    sizeBytes: 2_000_000,
    indexedAt: 0,
    ...over,
  }
}

const BOOKS = Array.from({ length: 120 }, (_, i) => book(`b${i}`))
const DIMS = new Map(BOOKS.map((b) => [b.id, dimensionsFor(b)]))
const lookup = (id: string) => DIMS.get(id)

test.describe('book dimensions', () => {
  test('are stable for a given id', () => {
    expect(dimensionsFor(book('same'))).toEqual(dimensionsFor(book('same')))
    expect(dimensionsFor(book('a')).colour).not.toBe(undefined)
  })

  test('thickness follows page count where there is one', () => {
    const thin = dimensionsFor(book('x', { pageCount: 40 })).thickness
    const fat = dimensionsFor(book('x', { pageCount: 900 })).thickness
    expect(fat).toBeGreaterThan(thin)
  })

  test('a book with no page count still gets a plausible thickness', () => {
    const size = dimensionsFor(book('e', { format: 'epub', pageCount: null }))
    expect(size.thickness).toBeGreaterThan(0.01)
    expect(size.thickness).toBeLessThan(0.08)
  })

  test('hashing is deterministic and spreads ids', () => {
    expect(hashId('abc')).toBe(hashId('abc'))
    expect(hashId('abc')).not.toBe(hashId('abd'))
  })
})

test.describe('shelving', () => {
  test('row keys round-trip', () => {
    expect(parseRowKey(rowKey('west-3', 2))).toEqual({ shelfId: 'west-3', row: 2 })
    expect(parseRowKey('nonsense')).toBeNull()
    // Ids are free-form apart from the colon, and the split takes the last one.
    expect(parseRowKey(rowKey('reading-n0', 4))).toEqual({ shelfId: 'reading-n0', row: 4 })
  })

  test('a packed row keeps books inside the compartment and in order', () => {
    const ids = BOOKS.slice(0, 12).map((b) => b.id)
    const packed = packRow(SHELF_0, 0, 0, ids, lookup)

    for (const item of packed) {
      const size = DIMS.get(item.id)!
      expect(Math.abs(item.localX) + size.thickness / 2).toBeLessThanOrEqual(INTERIOR_WIDTH / 2)
      expect(size.height).toBeLessThan(ROW_HEIGHT)
      expect(item.localZ + size.depth / 2).toBeLessThanOrEqual(SHELF.depth / 2)
    }

    for (let i = 1; i < packed.length; i++) {
      const previous = packed[i - 1]!
      const current = packed[i]!
      const gap =
        current.localX -
        DIMS.get(current.id)!.thickness / 2 -
        (previous.localX + DIMS.get(previous.id)!.thickness / 2)
      expect(gap).toBeCloseTo(0, 6)
    }
  })

  test('a row that cannot fit is refused rather than overflowing', () => {
    const tooMany = BOOKS.map((b) => b.id)
    expect(rowFits(tooMany, lookup)).toBe(false)
    // packRow still refuses to draw past the side panel.
    const packed = packRow(SHELF_0, 0, 0, tooMany, lookup)
    expect(packed.length).toBeLessThan(tooMany.length)
  })

  test('auto-arrange spreads books across rows without losing any that fit', () => {
    const { rows, leftOver } = arrangeInto(WORLD, {}, BOOKS.map((b) => b.id), lookup)
    const placed = Object.values(rows).flat()
    expect(leftOver).toEqual([])
    expect(placed.length).toBe(BOOKS.length)
    expect(new Set(placed).size).toBe(BOOKS.length)
    const keys = allRowKeys(WORLD)
    for (const [key, ids] of Object.entries(rows)) {
      expect(keys).toContain(key)
      expect(rowFits(ids, lookup)).toBe(true)
    }
  })

  test('auto-arrange reports what would not fit instead of spilling', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => book(`x${i}`))
    const dims = new Map(many.map((b) => [b.id, dimensionsFor(b)]))
    const { rows, leftOver } = arrangeInto(WORLD, {}, many.map((b) => b.id), (id) => dims.get(id))
    expect(Object.keys(rows).length).toBeLessThanOrEqual(allRowKeys(WORLD).length)
    expect(Object.values(rows).flat().length).toBeLessThan(many.length)
    expect(leftOver.length).toBe(many.length - Object.values(rows).flat().length)
  })

  test('a height maps back to the row it belongs to', () => {
    const rowCount = SHELF_0.rows
    expect(rowFromLocalY(-1, rowCount)).toBeNull()
    expect(rowFromLocalY(99, rowCount)).toBeNull()
    const rows = new Set<number | null>()
    for (let y = 0; y < SHELF.height; y += 0.01) rows.add(rowFromLocalY(y, rowCount))
    for (let row = 0; row < rowCount; row++) expect(rows).toContain(row)
  })

  test('compartments get taller when a case has fewer shelves', () => {
    expect(rowMetrics(4).rowHeight).toBeGreaterThan(rowMetrics(6).rowHeight)
    // Whatever the count, the top compartment still ends under the top board.
    for (const count of [3, 4, 5, 6, 8]) {
      const { rowHeight, surfaceY } = rowMetrics(count)
      expect(surfaceY(count - 1) + rowHeight).toBeLessThanOrEqual(SHELF.height - SHELF.board + 1e-9)
    }
  })

  test('insertion index follows where along the shelf you are aiming', () => {
    const ids = BOOKS.slice(0, 6).map((b) => b.id)
    const packed = packRow(SHELF_0, 0, 0, ids, lookup)

    expect(insertionIndex(packed, -10)).toBe(0)
    expect(insertionIndex(packed, 10)).toBe(packed.length)

    const third = packed[2]!
    // Just left of the third book's centre means "goes before it".
    expect(insertionIndex(packed, third.localX - 0.001)).toBe(2)
    expect(insertionIndex(packed, third.localX + 0.001)).toBe(3)
  })
})
