import { expect, test } from '@playwright/test'
import { blocked } from '../src/scene/collision'
import { deriveWorld } from '../src/world/derive'
import { parseWorldText, type WorldDocument } from '../src/world/schema'
import { DEFAULT_WORLD_TEXT } from '../src/world/defaults'
import { LAYOUT_SCHEMA_VERSION, reconcile } from '../src/world/reconcile'
import { packBoxes } from '../src/world/boxes'
import { allRowKeys, arrangeInto, emptyRowsFirst } from '../src/scene/shelving'
import { dimensionsFor } from '../src/data/dimensions'
import { mulberry32 } from '../src/lib/rng'
import type { IndexedBook } from '../src/services/types'

/**
 * The world document, and — the part worth being careful about — what happens
 * to a library you have arranged by hand when you edit the room underneath it.
 *
 * These run in the browser project because the source is TypeScript modules
 * Playwright transpiles; none of them need a page.
 */

const WORLD = deriveWorld(parseWorldText(DEFAULT_WORLD_TEXT))

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

/** The default world with `edit` applied to its parsed document. */
function worldWith(edit: (doc: WorldDocument) => void) {
  const doc = parseWorldText(DEFAULT_WORLD_TEXT)
  edit(doc)
  return deriveWorld(doc)
}

test.describe('world document', () => {
  test('the default the app writes for you actually parses', () => {
    expect(WORLD.rooms.length).toBe(2)
    expect(WORLD.shelves.length).toBeGreaterThan(10)
    expect(WORLD.furniture.some((f) => f.kind === 'box')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'armchair')).toBe(true)
  })

  test('comments are allowed, because the file is meant to be read', () => {
    const world = parseWorldText(`{
      // a room
      "rooms": [{ "id": "a", "origin": [0, 0], /* inline */ "size": [4, 4],
                  "shelves": [{ "id": "s", "at": [0, 0], "facing": 0, "rows": 5 }] }]
    }`)
    expect(world.rooms[0]!.shelves[0]!.id).toBe('s')
  })

  test('a // inside a string is not a comment', () => {
    const world = parseWorldText(`{
      "name": "https://example.com/library",
      "rooms": [{ "id": "a", "origin": [0, 0], "size": [4, 4] }]
    }`)
    expect(world.name).toBe('https://example.com/library')
  })

  test('a mistake names the field that is wrong', () => {
    let message = ''
    try {
      parseWorldText(`{ "rooms": [{ "id": "a", "origin": [0, 0], "size": [4, 4],
        "shelves": [{ "id": "s", "at": 3, "facing": 0 }] }] }`)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('rooms[0].shelves[0].at')
    expect(message).toContain('[x, z]')
  })

  test('duplicate shelf ids are refused, because they would merge two shelves', () => {
    expect(() =>
      parseWorldText(`{ "rooms": [{ "id": "a", "origin": [0, 0], "size": [4, 4], "shelves": [
        { "id": "s", "at": [0, 0], "facing": 0 },
        { "id": "s", "at": [1, 0], "facing": 0 }
      ] }] }`),
    ).toThrow(/used more than once/)
  })

  test('a colon in an id is refused, because row keys are shelfId:row', () => {
    expect(() =>
      parseWorldText(`{ "rooms": [{ "id": "a", "origin": [0, 0], "size": [4, 4],
        "shelves": [{ "id": "we:ird", "at": [0, 0], "facing": 0 }] }] }`),
    ).toThrow(/may not contain a colon/)
  })

  test('a door is walkable and a window is not', () => {
    const world = deriveWorld(
      parseWorldText(`{ "rooms": [{ "id": "a", "origin": [0, 0], "size": [6, 6], "openings": [
        { "wall": "east", "at": 0, "width": 1.2, "height": 2.05, "sill": 0, "kind": "door" },
        { "wall": "west", "at": 0, "width": 1.2, "height": 1.4, "sill": 0.9, "kind": "window" }
      ] }] }`),
    )
    expect(blocked(world.colliders, { x: 3.06, z: 0 }, 0.28)).toBe(false)
    expect(blocked(world.colliders, { x: -3.06, z: 0 }, 0.28)).toBe(true)
  })

  test('the two default rooms are joined, not sealed off from each other', () => {
    expect(WORLD.rooms.map((r) => r.id)).toEqual(['main', 'reading'])
    // Walk the doorway from one room into the other along z = 0.
    for (let x = 3.0; x <= 7.0; x += 0.05) {
      expect(
        blocked(WORLD.colliders, { x, z: 0 }, 0.28),
        `blocked crossing at x=${x.toFixed(2)}`,
      ).toBe(false)
    }
  })
})

test.describe('reconciling a layout with a changed room', () => {
  const ids = BOOKS.map((b) => b.id)
  /** A library somebody has shelved — which is now the only way books get shelved. */
  const saved = {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    rows: arrangeInto(WORLD, {}, ids, lookup).rows,
  }

  test('a newly indexed library arrives in the boxes, not on the shelves', () => {
    const firstRun = reconcile(WORLD, null, ids, lookup)
    expect(firstRun.firstRun).toBe(true)
    expect(firstRun.rows).toEqual({})
    expect([...firstRun.boxed].sort()).toEqual([...ids].sort())

    // Spread across the boxes rather than piled into the first one.
    const counts = Object.values(firstRun.boxes).map((v) => v.length)
    expect(counts.length).toBe(4)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  test('reloading an unchanged room changes nothing at all', () => {
    const again = reconcile(WORLD, saved, ids, lookup)
    expect(again.rows).toEqual(saved.rows)
    expect(again.boxed).toEqual([])
  })

  test('moving a bookcase carries its books with it', () => {
    const moved = worldWith((doc) => {
      const shelf = doc.rooms[0]!.shelves[0]!
      shelf.at = [shelf.at[0], shelf.at[1] + 0.4]
      shelf.facing = 90
    })
    const result = reconcile(moved, saved, ids, lookup)
    expect(result.boxed).toEqual([])
    expect(result.rows).toEqual(saved.rows)
  })

  test('reordering the file does not disturb a single book', () => {
    const shuffled = worldWith((doc) => {
      doc.rooms[0]!.shelves.reverse()
      doc.rooms.reverse()
    })
    const result = reconcile(shuffled, saved, ids, lookup)
    expect(result.boxed).toEqual([])
    expect(result.rows).toEqual(saved.rows)
  })

  test('deleting a bookcase puts its books in boxes, not on other shelves', () => {
    const gone = worldWith((doc) => {
      doc.rooms[0]!.shelves = doc.rooms[0]!.shelves.filter((s) => s.id !== 'west-0')
    })
    const lost = Object.entries(saved.rows)
      .filter(([key]) => key.startsWith('west-0:'))
      .flatMap(([, value]) => value)
    expect(lost.length).toBeGreaterThan(0)

    const result = reconcile(gone, saved, ids, lookup)
    expect([...result.boxed].sort()).toEqual([...lost].sort())
    // Every surviving row is untouched: nothing was quietly reshuffled.
    for (const [key, value] of Object.entries(saved.rows)) {
      if (key.startsWith('west-0:')) continue
      expect(result.rows[key]).toEqual(value)
    }
  })

  test('renaming a bookcase reads as deleting it', () => {
    const renamed = worldWith((doc) => {
      doc.rooms[0]!.shelves[0]!.id = 'west-0-renamed'
    })
    const result = reconcile(renamed, saved, ids, lookup)
    expect(result.boxed.length).toBeGreaterThan(0)
    expect(result.rows['west-0-renamed:0']).toBeUndefined()
  })

  test('putting a deleted bookcase back restores its books to it', () => {
    const gone = worldWith((doc) => {
      doc.rooms[0]!.shelves = doc.rooms[0]!.shelves.filter((s) => s.id !== 'west-0')
    })
    // The layout on disk is deliberately *not* pruned while the shelf is away,
    // which is what makes the edit reversible.
    expect(reconcile(gone, saved, ids, lookup).boxed.length).toBeGreaterThan(0)
    const restored = reconcile(WORLD, saved, ids, lookup)
    expect(restored.boxed).toEqual([])
    expect(restored.rows).toEqual(saved.rows)
  })

  test('taking shelves off a case boxes only the rows that went', () => {
    const shorter = worldWith((doc) => {
      doc.rooms[0]!.shelves[0]!.rows = 3
    })
    const lost = [...(saved.rows['west-0:3'] ?? []), ...(saved.rows['west-0:4'] ?? [])]
    expect(lost.length).toBeGreaterThan(0)
    const result = reconcile(shorter, saved, ids, lookup)
    expect([...result.boxed].sort()).toEqual([...lost].sort())
    expect(result.rows['west-0:0']).toEqual(saved.rows['west-0:0'])
  })

  test('books new since the last layout go into the boxes, not onto a shelf', () => {
    const extra = Array.from({ length: 5 }, (_, i) => book(`new${i}`))
    const dims = new Map([...DIMS, ...extra.map((b) => [b.id, dimensionsFor(b)] as const)])
    const result = reconcile(WORLD, saved, [...ids, ...extra.map((b) => b.id)], (id) =>
      dims.get(id),
    )

    // A scan must not rearrange a library you have already put in order: what
    // it found is new, and new books are unpacked by hand.
    expect(result.rows).toEqual(saved.rows)
    expect([...result.boxed].sort()).toEqual(extra.map((b) => b.id).sort())
    expect([...result.fresh].sort()).toEqual(extra.map((b) => b.id).sort())
  })

  test('a book whose file is gone is simply gone, not reported as displaced', () => {
    const fewer = ids.slice(0, ids.length - 10)
    const result = reconcile(WORLD, saved, fewer, lookup)
    expect(result.boxed).toEqual([])
    expect(Object.values(result.rows).flat().length).toBe(fewer.length)
  })

  test('every book is either on a shelf or in a box, never neither', () => {
    const many = Array.from({ length: 4000 }, (_, i) => book(`x${i}`))
    const dims = new Map(many.map((b) => [b.id, dimensionsFor(b)]))
    const all = many.map((b) => b.id)
    const result = reconcile(WORLD, { schemaVersion: LAYOUT_SCHEMA_VERSION, rows: {} }, all, (id) =>
      dims.get(id),
    )
    const shelved = Object.values(result.rows).flat().length
    expect(shelved).toBe(0)
    expect(result.boxed.length).toBe(all.length)
  })
})

test.describe('sorting books into boxes', () => {
  const ids = BOOKS.map((b) => b.id)

  test('a book put in a particular box is in that box on the next load', () => {
    const saved = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      rows: {},
      boxes: { 'box-3': [ids[0]!, ids[1]!] },
    }
    const result = reconcile(WORLD, saved, ids, lookup)
    expect(result.boxes['box-3']!.slice(0, 2)).toEqual([ids[0], ids[1]])
  })

  test('deleting a box tips its books into the ones that are left', () => {
    const saved = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      rows: {},
      boxes: { 'box-1': ids.slice(0, 10) },
    }
    const fewer = worldWith((doc) => {
      const room = doc.rooms[0]!
      room.furniture = room.furniture.filter((f) => f.id !== 'box-1')
    })

    const result = reconcile(fewer, saved, ids, lookup)
    expect(result.boxes['box-1']).toBeUndefined()
    expect([...result.boxed].sort()).toEqual([...ids].sort())
    // And putting it back in the document puts its books back in it.
    expect(reconcile(WORLD, saved, ids, lookup).boxes['box-1']!.slice(0, 10)).toEqual(
      ids.slice(0, 10),
    )
  })

  test('a shelf beats a box for a book that somehow claims both', () => {
    const saved = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      rows: { 'west-0:0': [ids[0]!] },
      boxes: { 'box-1': [ids[0]!] },
    }
    const result = reconcile(WORLD, saved, [ids[0]!], lookup)
    expect(result.rows['west-0:0']).toEqual([ids[0]])
    expect(result.boxed).toEqual([])
  })
})

test.describe('unpacking a box onto the shelves', () => {
  test('empty rows are filled first, and in no particular order', () => {
    const inUse = { 'west-0:0': [BOOKS[0]!.id] }
    const order = emptyRowsFirst(WORLD, inUse, mulberry32(7))

    expect(new Set(order).size).toBe(order.length)
    expect([...order].sort()).toEqual([...allRowKeys(WORLD)].sort())
    // The one row that already holds a book comes last, after every empty one.
    expect(order.at(-1)).toBe('west-0:0')
    // Filling in document order would stack a boxful into the first bookcase
    // by the door and leave the rest of the room bare.
    expect(order.slice(0, 8)).not.toEqual(allRowKeys(WORLD).slice(0, 8))
  })

  test('unpacking is repeatable: the same box lands in the same rows', () => {
    const ids = BOOKS.slice(0, 40).map((b) => b.id)
    const once = arrangeInto(WORLD, {}, ids, lookup, emptyRowsFirst(WORLD, {}, mulberry32(11)))
    const twice = arrangeInto(WORLD, {}, ids, lookup, emptyRowsFirst(WORLD, {}, mulberry32(11)))
    expect(twice.rows).toEqual(once.rows)
  })

  test('a boxful the shelves cannot take is left in the box, not dropped', () => {
    const many = Array.from({ length: 4000 }, (_, i) => book(`x${i}`))
    const dims = new Map(many.map((b) => [b.id, dimensionsFor(b)]))
    const ids = many.map((b) => b.id)
    const arranged = arrangeInto(
      WORLD,
      {},
      ids,
      (id) => dims.get(id),
      emptyRowsFirst(WORLD, {}, mulberry32(3)),
    )

    const shelved = Object.values(arranged.rows).flat()
    expect(shelved.length).toBeGreaterThan(100)
    expect(shelved.length + arranged.leftOver.length).toBe(ids.length)
  })
})

test.describe('moving boxes', () => {
  test('books stack inside the box they belong to and stay inside it', () => {
    const contents = {
      'box-1': BOOKS.slice(0, 15).map((b) => b.id),
      'box-3': BOOKS.slice(15, 30).map((b) => b.id),
    }
    const { placed } = packBoxes(WORLD, contents, lookup)
    expect(placed.length).toBeGreaterThan(0)

    // Each book is shown in the box it was put in, not merely in some box.
    for (const [boxId, ids] of Object.entries(contents)) {
      for (const id of ids) {
        const item = placed.find((p) => p.id === id)
        if (item) expect(item.boxId).toBe(boxId)
      }
    }

    const boxes = new Map(WORLD.furniture.filter((f) => f.kind === 'box').map((f) => [f.id, f]))
    for (const item of placed) {
      const box = boxes.get(item.boxId)!
      // Inside the footprint, allowing for the diagonal of a rotated box.
      const reach = Math.hypot(box.width, box.depth) / 2
      expect(Math.hypot(item.x - box.x, item.z - box.z)).toBeLessThanOrEqual(reach)
      expect(item.y).toBeGreaterThan(0)
      expect(item.y).toBeLessThan(box.height)
    }
  })

  test('a box holds more than it can show, and says so rather than losing them', () => {
    const tooMany = BOOKS.map((b) => b.id)
    const packing = packBoxes(WORLD, { 'box-1': tooMany }, lookup)
    expect(packing.placed.length).toBeGreaterThan(0)
    expect(packing.placed.length).toBeLessThan(tooMany.length)
    expect(packing.placed.length + packing.hidden.length).toBe(tooMany.length)
  })

  test('with no boxes in the room, unshelved books have nowhere to be shown', () => {
    const bare = worldWith((doc) => {
      for (const room of doc.rooms) room.furniture = []
    })
    const unshelved = BOOKS.slice(0, 5).map((b) => b.id)

    // Nothing is assigned to a box that does not exist...
    const result = reconcile(
      bare,
      { schemaVersion: LAYOUT_SCHEMA_VERSION, rows: {} },
      unshelved,
      lookup,
    )
    expect(result.boxes).toEqual({})
    // ...but they are still unshelved, and still counted.
    expect([...result.boxed].sort()).toEqual([...unshelved].sort())
    expect(packBoxes(bare, result.boxes, lookup).placed).toEqual([])
  })
})
