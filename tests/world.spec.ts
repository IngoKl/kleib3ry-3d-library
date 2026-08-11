import { expect, test } from '@playwright/test'
import { blocked } from '../src/scene/collision'
import { solidsAt, stepPlayer, type Stance } from '../src/scene/walk'
import { shelfColliders } from '../src/world/shelf'
import {
  FLOOR_SLAB,
  STEP_UP,
  WALL_MOUNTED,
  deriveWorld,
  floorAt,
  roomBounds,
} from '../src/world/derive'
import { GROUND_Y, LAKE, PATH, WALK_RADIUS, lakeRadius, terrainAt } from '../src/world/terrain'
import { occupied } from '../src/world/forest'
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
    // The cabin: a great room, the loft inside its volume, a reading corner
    // with the bedroom on top of it, a kitchen, a bathroom off it, an office
    // and a porch — and then, a trail away, the lake house and its deck. Two
    // buildings in one document, which the format always allowed.
    expect(WORLD.rooms.map((r) => r.id)).toEqual([
      'main',
      'loft',
      'reading',
      'bedroom',
      'kitchen',
      'bathroom',
      'office',
      'porch',
      'lakehouse',
      'lakedeck',
    ])
    expect(WORLD.shelves.length).toBeGreaterThan(10)
    expect(WORLD.furniture.some((f) => f.kind === 'box')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'armchair')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'recordplayer')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'bed')).toBe(true)
    // The television den in the loft, and the office it takes a whiteboard to be.
    expect(WORLD.furniture.some((f) => f.kind === 'crt')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'tapecrate')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'whiteboard')).toBe(true)
    // The marker that writes on it, and the clock in the great room.
    expect(WORLD.furniture.some((f) => f.kind === 'marker')).toBe(true)
    expect(WORLD.furniture.some((f) => f.kind === 'clock')).toBe(true)
    // The bathroom has a deck and deliberately no crate to go with it.
    const bath = WORLD.furniture.filter((f) => f.roomId === 'bathroom')
    expect(bath.some((f) => f.kind === 'recordplayer')).toBe(true)
    expect(bath.some((f) => f.kind === 'recordshelf')).toBe(false)
  })

  test('no window has the floor of the room above running through it', () => {
    // The great room's north window used to reach 2.9 m up a wall the loft floor
    // crosses at 2.28, so from the lake the view window had a plank across it.
    // Stated generally, because the same mistake is available in every room with
    // a storey over part of it — and it is invisible from inside, where the sill
    // and the head are both just wall.
    const problems: string[] = []

    for (const room of WORLD.rooms) {
      const bounds = roomBounds(room)
      for (const opening of room.openings) {
        const head = room.elevation + opening.sill + opening.height
        // A point just inside the wall the opening is in, so a room whose
        // footprint merely *touches* this wall does not count as crossing it.
        const inset = 0.05
        const at =
          opening.wall === 'north'
            ? { x: room.origin[0] + opening.at, z: bounds.minZ + inset }
            : opening.wall === 'south'
              ? { x: room.origin[0] + opening.at, z: bounds.maxZ - inset }
              : opening.wall === 'west'
                ? { x: bounds.minX + inset, z: room.origin[1] + opening.at }
                : { x: bounds.maxX - inset, z: room.origin[1] + opening.at }

        for (const over of WORLD.rooms) {
          if (over === room) continue
          // Only a floor *inside* this room's volume can cross its openings.
          if (over.elevation <= room.elevation + 1e-6) continue
          if (over.elevation >= room.elevation + room.height - 1e-6) continue
          const b = roomBounds(over)
          if (at.x < b.minX || at.x > b.maxX || at.z < b.minZ || at.z > b.maxZ) continue

          const underside = over.elevation - FLOOR_SLAB
          if (head > underside + 1e-6) {
            problems.push(
              `${room.id}'s ${opening.wall} ${opening.kind} reaches ${head.toFixed(2)} ` +
                `but ${over.id}'s floor starts at ${underside.toFixed(2)}`,
            )
          }
        }
      }
    }

    expect(problems, problems.join('; ')).toEqual([])
  })

  test('the office is walked into from the kitchen, not sealed off', () => {
    const ground = solidsAt([...WORLD.solids, ...shelfColliders(WORLD.shelves)], 0)
    // The matching pair of doors at world x = 8.44. Nothing solid the whole way
    // through, and floor under every step of it.
    for (let z = 2.6; z <= 4.1; z += 0.05) {
      expect(floorAt(WORLD, 8.44, z, 0), `no floor at z=${z.toFixed(2)}`).toBe(0)
      expect(blocked(ground, { x: 8.44, z }, 0.28), `blocked at z=${z.toFixed(2)}`).toBe(false)
    }
  })
  test('the loft is a storey, with a stair and a hole for it to come up', () => {
    const loft = WORLD.rooms.find((room) => room.id === 'loft')!
    expect(loft.elevation).toBeGreaterThan(2)
    expect(loft.holes.length).toBe(1)
    // Its shelves stand on its floor rather than on the ground.
    expect(WORLD.shelves.filter((s) => s.roomId === 'loft').every((s) => s.y === loft.elevation))
      .toBe(true)

    const stair = WORLD.stairs[0]!
    expect(stair.bottom).toBe(0)
    expect(stair.top).toBeCloseTo(loft.elevation, 5)

    // The climb is continuous: no step bigger than one, all the way up — for
    // *every* flight in the cabin, the bedroom's included. The trace is
    // collected first so a failure names *where* the flight breaks — "a 0.6 m
    // step two thirds of the way up" is a fixable report and "expected 0.42"
    // is not. Walked along the flight's own up-vector rather than assuming it
    // climbs +Z, so re-orienting a staircase in the default map does not
    // falsify the test.
    for (const flight of WORLD.stairs) {
      const climb: { z: number; floor: number | null }[] = []
      const at = (t: number) => ({
        x: flight.x + flight.dx * (t - 0.5) * flight.run,
        z: flight.z + flight.dz * (t - 0.5) * flight.run,
      })
      let previous = floorAt(WORLD, at(0).x, at(0).z, flight.bottom)!
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const { x, z } = at(t)
        const here = floorAt(WORLD, x, z, previous)
        climb.push({ z: +z.toFixed(3), floor: here })
        if (here !== null) previous = here
      }

      const gaps = climb
        .map((step, i) => ({ ...step, rise: i === 0 ? 0 : (step.floor ?? NaN) - (climb[i - 1]!.floor ?? NaN) }))
        .filter((step) => step.floor === null || !(Math.abs(step.rise) <= STEP_UP))
      expect(gaps, `a flight is not walkable: ${JSON.stringify(gaps)}`).toEqual([])

      // …and you arrive on the upper floor, not under it.
      expect(previous).toBeCloseTo(flight.top, 2)
    }
  })

  test('the treads reach as far up as the ramp does', () => {
    // The renderer draws a flight `height` tall and the walk controller climbs
    // `rise`, and for a while those were two different numbers: `rise` was read
    // from the document while `height` fell back to the kind's default 2.6. The
    // bedroom flight climbs 3.22, so its treads stopped 62 cm under the floor
    // they deliver you onto — walkable, and visibly not joined.
    for (const flight of WORLD.stairs) {
      const drawn = WORLD.furniture.find((item) => item.id === flight.id)!
      expect(drawn.height, `the ${flight.id} treads do not reach the landing`).toBeCloseTo(
        flight.top - flight.bottom,
        5,
      )
    }
  })

  test('what is hung on a wall hangs where the document says', () => {
    // `y` on a picture or a whiteboard is the centre of the thing — that is how
    // anybody hanging one thinks about it, and it is what custom-maps.md
    // promises. The derived `y` is the *base*, like every other piece, so the
    // two differ by half the height and nothing else. The renderer's half of
    // this — that a hung body is actually *drawn* about that centre — is in
    // smoke.spec.ts, which can see the meshes.
    for (const room of WORLD.rooms) {
      for (const spec of room.furniture) {
        if (!WALL_MOUNTED.has(spec.kind) || spec.y === undefined) continue
        const item = WORLD.furniture.find((piece) => piece.id === spec.id)!
        expect(item.y + item.height / 2 - room.elevation, `${spec.id} hangs at the wrong height`)
          .toBeCloseTo(spec.y, 5)
      }
    }
  })

  test('you cannot walk off the loft', () => {
    const loft = WORLD.rooms.find((room) => room.id === 'loft')!
    const edge = loft.origin[1] + loft.size[1] / 2
    // A pace past the balustrade there is only the ground floor, two and a half
    // metres down — which is a fall, so `floorAt` refuses to offer it.
    expect(floorAt(WORLD, 0, edge + 0.6, loft.elevation)).toBe(0)
    expect(Math.abs(0 - loft.elevation)).toBeGreaterThan(STEP_UP)
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

  test('the rooms are joined, not sealed off from each other', () => {
    // The great room's west door into the reading corner, at z = 0.9. Asked on
    // the ground floor: the loft's solids sit two metres over this line.
    const ground = solidsAt([...WORLD.solids, ...shelfColliders(WORLD.shelves)], 0)
    for (let x = -3.4; x >= -6.0; x -= 0.05) {
      expect(blocked(ground, { x, z: 0.9 }, 0.28), `blocked crossing at x=${x.toFixed(2)}`).toBe(
        false,
      )
    }
  })

  test('the porch is walked onto, not stepped over', () => {
    // The porch is butted flush against the cabin rather than a doorway away,
    // so the decking and the floorboards meet with no gap to fall through.
    const ground = solidsAt([...WORLD.solids, ...shelfColliders(WORLD.shelves)], 0)
    for (let z = 3.0; z <= 5.4; z += 0.05) {
      expect(floorAt(WORLD, 2.6, z, 0), `no floor at z=${z.toFixed(2)}`).toBe(0)
      expect(blocked(ground, { x: 2.6, z }, 0.28), `blocked at z=${z.toFixed(2)}`).toBe(false)
    }
  })
})

test.describe('the roof', () => {
  const roofOf = (id: string) => WORLD.roofs.find((roof) => roof.roomId === id)

  test('only the topmost room over a patch of ground is roofed', () => {
    // The loft stands inside the great room's volume and shares its ceiling
    // exactly; the reading corner has the bedroom on top of it. Neither may
    // grow a roof, or the building has roofs indoors.
    expect(roofOf('loft')).toBeUndefined()
    expect(roofOf('reading')).toBeUndefined()

    for (const id of ['main', 'bedroom', 'kitchen', 'office', 'porch', 'lakehouse', 'lakedeck']) {
      expect(roofOf(id), `${id} has no roof`).toBeDefined()
    }
  })

  test('a gable rises from the top of its walls to a ridge above them', () => {
    const main = roofOf('main')!
    const room = WORLD.rooms.find((r) => r.id === 'main')!
    expect(main.kind).toBe('gable')
    // Pinned to the wall top, never sunk into the room: the eaves are exactly
    // the ceiling height, which is what keeps a roof out of a room's headroom.
    expect(main.eaves).toBeCloseTo(room.elevation + room.height, 6)
    expect(main.peak).toBeGreaterThan(main.eaves + 1)
    // Half the span, since a gable climbs to the middle.
    const span = main.covers.maxZ - main.covers.minZ
    expect(main.peak - main.eaves).toBeCloseTo(Math.tan(main.pitch) * (span / 2), 6)
  })

  test('a roof does not overhang into the building it leans on', () => {
    // The porch's shed roof climbs north to meet the cabin. Given an overhang
    // on that side it reached 45 cm through the south wall and came out over
    // the great room, which is the bug this asserts against.
    const porch = roofOf('porch')!
    const room = WORLD.rooms.find((r) => r.id === 'porch')!
    expect(porch.kind).toBe('shed')
    expect(porch.covers.minZ).toBeCloseTo(room.origin[1] - room.size[1] / 2, 6)
    // ...and it still stands out over the decking on its low side.
    expect(porch.covers.maxZ).toBeGreaterThan(room.origin[1] + room.size[1] / 2 + 0.2)

    // Tucked under the cabin's wall rather than through it.
    const cabin = WORLD.rooms.find((r) => r.id === 'main')!
    expect(porch.peak).toBeLessThan(cabin.elevation + cabin.height)

    // The kitchen's gable end abuts the great room's east wall for the same
    // reason, and is flush with it.
    const kitchen = roofOf('kitchen')!
    const kitchenRoom = WORLD.rooms.find((r) => r.id === 'kitchen')!
    expect(kitchen.covers.minX).toBeCloseTo(kitchenRoom.origin[0] - kitchenRoom.size[0] / 2, 6)
  })

  test('nothing you can stand on is under a roof slope', () => {
    // Every roof begins at its own room's ceiling, so no floor in the building
    // is ever within reach of one. Cheap to state, and the thing that would
    // break first if the plane were ever anchored anywhere else.
    for (const roof of WORLD.roofs) {
      const room = WORLD.rooms.find((r) => r.id === roof.roomId)!
      expect(roof.eaves).toBeGreaterThanOrEqual(room.elevation + room.height - 1e-6)
    }
  })
})

test.describe('outside', () => {
  const solids = [...WORLD.solids, ...shelfColliders(WORLD.shelves)]

  test('the ground is a floor, and the lake is not', () => {
    // A clearing north of the cabin, on the way down to the water.
    expect(terrainAt(0, -8)).toBe(GROUND_Y)
    // The middle of the lake.
    expect(terrainAt(LAKE.x, LAKE.z)).toBeNull()
    // And the world ends somewhere, in fog rather than at a visible wall.
    expect(terrainAt(WALK_RADIUS + 4, 0)).toBeNull()
  })

  test('indoors, the boards win over the ground under them', () => {
    // The ground now runs under the whole building, and it must lose every tie:
    // standing in the great room the floor is the floor, not the grass at -0.24.
    expect(floorAt(WORLD, 0, 0, 0)).toBe(0)
    expect(floorAt(WORLD, 0, 0, 2.5)).toBe(2.5)
  })

  test('you can walk out of the porch and down onto the grass', () => {
    // Straight out of the cabin's south door at world x = 2.6, across the
    // decking and down the steps, which are now directly below it — the gap in
    // the railing used to be at the far end, so leaving meant threading between
    // the porch furniture. The drop from the decking is 24 cm, which is a step
    // rather than a fall.
    let stance: Stance = { x: 2.6, z: 5.6, floor: 0 }
    for (let i = 0; i < 60; i++) {
      stance = stepPlayer(WORLD, solids, stance, { x: stance.x, z: stance.z + 0.05 }, 0.28)
    }
    expect(stance.z, 'never got off the porch').toBeGreaterThan(8)
    expect(stance.floor).toBeCloseTo(GROUND_Y, 6)
  })

  test('and you cannot walk into the water', () => {
    // Straight down the cleared sight-line from the north windows to the shore.
    let stance: Stance = { x: LAKE.x, z: -9, floor: GROUND_Y }
    for (let i = 0; i < 400; i++) {
      stance = stepPlayer(WORLD, solids, stance, { x: stance.x, z: stance.z - 0.05 }, 0.28)
    }
    // Stopped at the water's edge, having actually got there.
    expect(lakeRadius(stance.x, stance.z)).toBeGreaterThanOrEqual(1)
    expect(lakeRadius(stance.x, stance.z)).toBeLessThan(1.05)
  })

  test('there is a walk round the pond, and no trees standing in it', () => {
    const middle = (PATH.from + PATH.to) / 2
    const keepOut = WORLD.rooms.map((room) => ({
      minX: room.origin[0] - room.size[0] / 2 - 4.5,
      maxX: room.origin[0] + room.size[0] / 2 + 4.5,
      minZ: room.origin[1] - room.size[1] / 2 - 4.5,
      maxZ: room.origin[1] + room.size[1] / 2 + 4.5,
    }))

    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * Math.PI * 2
      const x = LAKE.x + Math.cos(angle) * LAKE.radiusX * middle
      const z = LAKE.z + Math.sin(angle) * LAKE.radiusZ * middle
      const where = `${i} of 72, at (${x.toFixed(1)}, ${z.toFixed(1)})`

      expect(Math.hypot(x, z), `outside the world: ${where}`).toBeLessThan(WALK_RADIUS)
      expect(floorAt(WORLD, x, z, GROUND_Y), `no ground: ${where}`).toBe(GROUND_Y)
      // The forest is grown around the path, so nothing may be planted in it.
      expect(occupied(x, z, keepOut), `a tree could grow at ${where}`).toBe(true)
      expect(blocked(solidsAt(solids, GROUND_Y), { x, z }, 0.28), `blocked: ${where}`).toBe(false)
    }
  })

  test('a tree is something you walk into, not through', () => {
    // The forest used to be scenery. Now that the ground is walkable it has to
    // be solid, and it has to be solid at *head* height as well as at the knees.
    const here = solidsAt(solids, GROUND_Y)
    expect(WORLD.trees.length).toBeGreaterThan(100)
    const trunks = WORLD.trees.filter((tree) =>
      blocked(here, { x: tree.x, z: tree.z }, 0.05),
    )
    expect(trunks.length).toBe(WORLD.trees.length)
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
