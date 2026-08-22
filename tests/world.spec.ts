import { expect, test } from '@playwright/test'
import { blocked } from '../src/scene/collision'
import { solidsAt, stepPlayer, type Stance } from '../src/scene/walk'
import { shelfColliders } from '../src/world/shelf'
import {
  FLOOR_SLAB,
  FURNITURE_SIZE,
  PORTABLE,
  SITTABLE,
  STEP_UP,
  WALL,
  WALL_MOUNTED,
  deliverySpot,
  deriveWorld,
  floorAt,
  roomBounds,
} from '../src/world/derive'
import {
  BRIDGES,
  BRIDGE_Y,
  CABLE_CAR,
  GROUND_Y,
  LAKE,
  MOUNTAIN_STEP,
  PATH,
  PLATFORM,
  SHORE_EDGE,
  STREAM,
  WALK_RADIUS,
  WATER_Y,
  cabinAt,
  inStream,
  lakePoint,
  lakeRadius,
  mountainHeight,
  onPlatform,
  shoreShape,
  terrainAt,
  underCable,
} from '../src/world/terrain'
import { cableRide, startRide, stepRide } from '../src/state/cableCar'
import { occupied } from '../src/world/forest'
import { SITE_IDS, parseWorldText, type WorldDocument } from '../src/world/schema'
import { DEFAULT_WORLD_TEXT } from '../src/world/defaults'
import { bookFolder, planFolderBoxSpots, reconcile } from '../src/world/reconcile'
import { boxesIn, packBoxes } from '../src/world/boxes'
import { allRowKeys, arrangeInto, emptyRowsFirst, nearestRowsFirst, parseRowKey } from '../src/scene/shelving'
import { dimensionsFor } from '../src/data/dimensions'
import { mulberry32 } from '../src/lib/rng'
import type { IndexedBook } from '../src/services/types'

/**
 * The world document, and what happens to a library you arranged by hand when
 * you edit the room underneath it. In the browser project because the source is
 * TypeScript Playwright transpiles; none of them need a page.
 */

const DOC = parseWorldText(DEFAULT_WORLD_TEXT)
const WORLD = deriveWorld(DOC)

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
    // The cabin and its rooms, then a trail away the lake house and its deck:
    // two buildings in one document, which the format always allowed.
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
      'camp',
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
    // A window whose head reaches past a floor slab shows a plank across the
    // view outside while looking like plain wall inside. Checked generally,
    // because the mistake is available in every room with a storey over it.
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

          // What is forbidden is the slab and the opening overlapping. One
          // wholly above the slab is a window in the upper room's own wall.
          const underside = over.elevation - FLOOR_SLAB
          const sill = room.elevation + opening.sill
          if (head > underside + 1e-6 && sill < over.elevation - 1e-6) {
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

  test('two openings never share a stretch of wall', () => {
    // `wallPanels` cuts the leftovers into piers, aprons and lintels, so two
    // openings overlapping along the wall cut each other's panels to ribbons.
    // Differing heights do not save you: the cut is made in plan.
    for (const room of WORLD.rooms) {
      for (const wall of ['north', 'south', 'east', 'west'] as const) {
        const on = room.openings.filter((o) => o.wall === wall).sort((a, b) => a.at - b.at)
        for (let i = 1; i < on.length; i++) {
          const previous = on[i - 1]!
          const current = on[i]!
          expect(
            current.at - current.width / 2,
            `${room.id}'s ${wall} wall has two openings over each other`,
          ).toBeGreaterThanOrEqual(previous.at + previous.width / 2 - 1e-6)
        }
      }
    }
  })

  test('the loft has a window of its own, in the wall the great room builds', () => {
    // The loft builds only its balustrade, so its window is an opening in the
    // great room's north wall, above the loft floor and hidden from below.
    const loft = WORLD.rooms.find((room) => room.id === 'loft')!
    const main = WORLD.rooms.find((room) => room.id === 'main')!
    const window = main.openings.find(
      (opening) => opening.kind === 'window' && opening.sill > loft.elevation,
    )
    expect(window, 'the loft has nothing to look out of').toBeDefined()
    expect(window!.sill + window!.height).toBeLessThan(main.height)
    // And the loft actually reaches the wall it is cut into.
    expect(roomBounds(loft).minZ).toBeCloseTo(roomBounds(main).minZ, 6)
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

    // No step bigger than one, all the way up, for every flight. The trace is
    // collected first so a failure names where the flight breaks — "a 0.6 m
    // step two thirds up" is fixable and "expected 0.42" is not. Walked along
    // the flight's own up-vector, so re-orienting one does not falsify this.
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
    // The renderer draws a flight `height` tall and the controller climbs
    // `rise`. Let those differ and the treads stop short of the floor they
    // deliver you onto — walkable, and visibly not joined.
    for (const flight of WORLD.stairs) {
      const drawn = WORLD.furniture.find((item) => item.id === flight.id)!
      expect(drawn.height, `the ${flight.id} treads do not reach the landing`).toBeCloseTo(
        flight.top - flight.bottom,
        5,
      )
    }
  })

  test('what is hung on a wall hangs where the document says', () => {
    // `y` on a hung piece is its centre, which is how anybody hanging one
    // thinks about it and what custom-maps.md promises; the derived `y` is the
    // base, so the two differ by half the height and nothing else. That a hung
    // body is actually drawn about that centre is smoke.spec.ts's half.
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
    // The loft shares the great room's ceiling and the reading corner has the
    // bedroom on top. Neither may grow a roof, or the building has one indoors.
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
    // The porch's shed roof climbs north to meet the cabin. With an overhang on
    // that side it comes out through the south wall over the great room.
    const porch = roofOf('porch')!
    const room = WORLD.rooms.find((r) => r.id === 'porch')!
    const wall = room.origin[1] - room.size[1] / 2
    expect(porch.kind).toBe('shed')
    // Stopped inside the cabin's wall slab rather than level with its face:
    // flush is two surfaces in one plane, which shimmers from the room below.
    expect(porch.covers.minZ).toBeGreaterThan(wall)
    expect(porch.covers.minZ).toBeLessThan(wall + WALL)
    // ...and it still stands out over the decking on its low side.
    expect(porch.covers.maxZ).toBeGreaterThan(room.origin[1] + room.size[1] / 2 + 0.2)

    // Tucked under the cabin's wall rather than through it.
    const cabin = WORLD.rooms.find((r) => r.id === 'main')!
    expect(porch.peak).toBeLessThan(cabin.elevation + cabin.height)

    // The kitchen's gable end abuts the great room's east wall for the same
    // reason, and stops inside it rather than reaching across the great room.
    const kitchen = roofOf('kitchen')!
    const kitchenRoom = WORLD.rooms.find((r) => r.id === 'kitchen')!
    const kitchenWall = kitchenRoom.origin[0] - kitchenRoom.size[0] / 2
    expect(kitchen.covers.minX).toBeGreaterThan(kitchenWall)
    expect(kitchen.covers.minX).toBeLessThan(kitchenWall + WALL)
  })

  test('nothing you can stand on is under a roof slope', () => {
    // Every roof begins at its room's ceiling, so no floor is ever within reach
    // of one — the first thing to break if the plane were anchored elsewhere.
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
    // Straight out of the south door, across the decking and down the steps, so
    // leaving does not mean threading between the porch furniture.
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

  test('the brook is water you cannot walk into, and the plank over it is floor', () => {
    const bridge = BRIDGES[0]!
    // Up the flow from the crossing, and still on the same leg of the brook.
    const up = { x: bridge.x - bridge.dx * 2.5, z: bridge.z - bridge.dz * 2.5 }
    expect(inStream(up.x, up.z)).toBe(true)
    expect(terrainAt(up.x, up.z)).toBeNull()

    // The deck itself, and the bank you step onto it from — a plank stands a
    // little proud of the ground, which is a step and not a climb.
    expect(terrainAt(bridge.x, bridge.z)).toBe(BRIDGE_Y)
    const bank = { x: bridge.x + bridge.dz * (bridge.reach + 0.5), z: bridge.z - bridge.dx * (bridge.reach + 0.5) }
    expect(terrainAt(bank.x, bank.z)).toBe(GROUND_Y)
    expect(BRIDGE_Y - GROUND_Y).toBeLessThan(STEP_UP)
  })

  test('the brook fords across the shore rather than cutting the walk round the lake', () => {
    // Its last stretch runs over the beach, where a stream goes shallow — which
    // is what keeps the ring path in one piece without a bridge in a puddle.
    const [ax, az] = STREAM[STREAM.length - 2]!
    const [bx, bz] = STREAM[STREAM.length - 1]!
    expect(lakeRadius(bx, bz), 'the brook never reaches the water').toBeLessThan(1)

    let fords = 0
    for (let i = 0; i <= 200; i++) {
      const t = i / 200
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const r = lakeRadius(x, z)
      if (r > PATH.to || r < 1.004) continue
      fords += 1
      expect(terrainAt(x, z), `no ground at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(GROUND_Y)
    }
    expect(fords, 'the brook does not cross the shore path at all').toBeGreaterThan(10)
  })

  test('a tree is something you walk into, not through', () => {
    // The ground is walkable, so a trunk has to be solid — and solid at *head*
    // height as well as at the knees.
    const here = solidsAt(solids, GROUND_Y)
    expect(WORLD.trees.length).toBeGreaterThan(100)
    const trunks = WORLD.trees.filter((tree) =>
      blocked(here, { x: tree.x, z: tree.z }, 0.05),
    )
    expect(trunks.length).toBe(WORLD.trees.length)
  })
})

test.describe('the mountains and the cable car', () => {
  const solids = [...WORLD.solids, ...shelfColliders(WORLD.shelves)]

  test('the mountainside is seen, not climbed: walkable toe, refused slope', () => {
    // The heart of the range is not a floor, exactly as the lake is not.
    expect(mountainHeight(-10, -101)).toBeGreaterThan(10)
    expect(terrainAt(-10, -101)).toBeNull()

    // Walking north from the camp, the ground rises under you and then the
    // step is refused — a slope, not an invisible wall at the foot.
    let stance: Stance = { x: 6, z: -70, floor: terrainAt(6, -70)! }
    for (let i = 0; i < 300; i++) {
      stance = stepPlayer(WORLD, solids, stance, { x: stance.x, z: stance.z - 0.05 }, 0.28)
    }
    const rise = mountainHeight(stance.x, stance.z)
    expect(rise, 'never reached the toe of the range').toBeGreaterThan(0)
    expect(rise).toBeLessThanOrEqual(MOUNTAIN_STEP + 0.01)
    expect(stance.floor).toBeCloseTo(GROUND_Y + rise, 6)
  })

  test('the lookout is a floor high over the lake, and you cannot walk off it', () => {
    expect(floorAt(WORLD, PLATFORM.x, PLATFORM.z, PLATFORM.y)).toBe(PLATFORM.y)
    // High enough that the whole lake reads as below you.
    expect(PLATFORM.y - WATER_Y).toBeGreaterThan(20)
    // ...and standing a plank's rise over the knoll, not buried in it.
    expect(PLATFORM.y - (GROUND_Y + mountainHeight(PLATFORM.x, PLATFORM.z))).toBeLessThan(1)

    // Walked hard at every rail: the drop is refused, exactly like the loft's.
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      let stance: Stance = { x: PLATFORM.x, z: PLATFORM.z, floor: PLATFORM.y }
      for (let i = 0; i < 120; i++) {
        stance = stepPlayer(
          WORLD,
          solids,
          stance,
          { x: stance.x + dx * 0.05, z: stance.z + dz * 0.05 },
          0.28,
        )
      }
      expect(onPlatform(stance.x, stance.z), `walked off the deck heading ${dx},${dz}`).toBe(true)
      expect(stance.floor).toBe(PLATFORM.y)
    }
  })

  test('the platform actually sees the lake', () => {
    // Eye height on the deck down to the water in the lake's middle: the line
    // must clear the range's own slopes the whole way.
    const eye = { x: PLATFORM.x, y: PLATFORM.y + 1.5, z: PLATFORM.z + PLATFORM.halfZ }
    for (let i = 1; i < 40; i++) {
      const t = i / 40
      const x = eye.x + (LAKE.x - eye.x) * t
      const z = eye.z + (LAKE.z - eye.z) * t
      const y = eye.y + (WATER_Y - eye.y) * t
      expect(
        y,
        `the mountainside blocks the view at (${x.toFixed(1)}, ${z.toFixed(1)})`,
      ).toBeGreaterThan(GROUND_Y + mountainHeight(x, z))
    }
    // And the far shore's trees are kept out of the sight-fan.
    const between = WORLD.trees.filter(
      (tree) => tree.z < -52 && tree.z > -78 && Math.abs(tree.x - PLATFORM.x) < 4,
    )
    expect(between).toEqual([])
  })

  test('the cabin path starts at the grass, ends at the deck, and clears the slope', () => {
    const start = cabinAt(0)
    expect(Math.abs(start.y - GROUND_Y)).toBeLessThan(STEP_UP)
    expect(terrainAt(start.x, start.z + 1.6), 'no ground at the base stop').toBe(GROUND_Y)

    const end = cabinAt(1)
    expect(end.y).toBeCloseTo(PLATFORM.y, 6)
    // Docked just off the deck's south edge, a scripted step from the landing.
    expect(Math.abs(end.x - PLATFORM.x)).toBeLessThan(2)
    expect(end.z - (PLATFORM.z + PLATFORM.halfZ)).toBeLessThan(1.5)

    // The cabin floor never scrapes the mountainside it climbs.
    for (let i = 2; i < 98; i++) {
      const at = cabinAt(i / 100)
      const ground = GROUND_Y + mountainHeight(at.x, at.z)
      expect(at.y - ground, `scraping at t=${(i / 100).toFixed(2)}`).toBeGreaterThan(0.3)
    }

    // No tree grows up into the line.
    for (const tree of WORLD.trees) {
      expect(underCable(tree.x, tree.z, 2.5), `a tree under the cable at ${tree.x}, ${tree.z}`)
        .toBe(false)
    }
  })

  test('the stations and the deck furniture are ordinary pieces the site provides', () => {
    const site = WORLD.furniture.filter((item) => item.roomId === 'site')
    expect(site.map((item) => item.id).sort()).toEqual([...SITE_IDS].sort())

    const base = site.find((item) => item.id === 'cablecar-base')!
    const top = site.find((item) => item.id === 'cablecar-top')!
    expect(base.kind).toBe('cablecar')
    expect(base.y).toBe(GROUND_Y)
    expect(top.y).toBe(PLATFORM.y)

    // Everything on the deck actually stands on the deck.
    for (const item of site) {
      if (item.id === 'cablecar-base') continue
      expect(onPlatform(item.x, item.z), `${item.id} hangs off the deck`).toBe(true)
    }

    // Seats to read in, a table to put a book on, and the string of lights is
    // a real lamp — on the pool, but not on the house switch's circuit.
    const chairs = site.filter((item) => SITTABLE.has(item.kind))
    expect(chairs.length).toBeGreaterThanOrEqual(3)
    expect(site.some((item) => item.surface)).toBe(true)

    // The record deck stands on its own table's top, an appliance like any
    // other — records ride up in hand, so the station is offered with one held.
    const stand = site.find((item) => item.id === 'lookout-stand')!
    const player = site.find((item) => item.id === 'lookout-player')!
    expect(player.kind).toBe('recordplayer')
    expect(player.y).toBeCloseTo(stand.y + stand.height, 6)
    expect(player.x).toBeCloseTo(stand.x, 6)
    expect(player.z).toBeCloseTo(stand.z, 6)
    const string = WORLD.lights.find((lamp) => lamp.id === 'lookout-lights')
    expect(string).toBeDefined()
    expect(string!.roomId).toBe('site')
    expect(string!.defaultOn).toBe(true)

    // The armchairs face the water, which is what the deck is for.
    for (const chair of site.filter((item) => item.kind === 'armchair')) {
      const off = Math.min(chair.facing, 360 - chair.facing)
      expect(off, `${chair.id} faces away from the lake`).toBeLessThan(30)
    }

    // Solid where they stand, like any other furniture — and the landing the
    // ride sets you down on is clear of all of it.
    expect(blocked(solidsAt(WORLD.solids, GROUND_Y), { x: base.x, z: base.z }, 0.05)).toBe(true)
    expect(blocked(solidsAt(WORLD.solids, PLATFORM.y), { x: top.x, z: top.z }, 0.05)).toBe(true)
    const landing = CABLE_CAR.landings.top
    expect(blocked(solidsAt(WORLD.solids, PLATFORM.y), { x: landing.x, z: landing.z }, 0.28)).toBe(
      false,
    )

    // And their ids are refused in a document, so a map cannot shadow them.
    expect(() =>
      parseWorldText(`{ "rooms": [{ "id": "a", "origin": [0, 0], "size": [4, 4], "furniture": [
        { "id": "cablecar-base", "kind": "table", "at": [0, 0], "facing": 0 }
      ] }] }`),
    ).toThrow(/reserved/)
  })

  test('a ride carries you up, and the next one carries you back down', () => {
    expect(cableRide.riding).toBe(false)
    const stand = { ...CABLE_CAR.landings.base }
    startRide('base', { x: stand.x, z: stand.z, floor: stand.y })

    let pose = stepRide(1 / 60)!
    let steps = 1
    while (cableRide.riding && steps < 10_000) {
      pose = stepRide(1 / 60)!
      steps += 1
    }
    expect(cableRide.riding, 'the ride never ended').toBe(false)
    expect(pose.x).toBeCloseTo(CABLE_CAR.landings.top.x, 6)
    expect(pose.z).toBeCloseTo(CABLE_CAR.landings.top.z, 6)
    expect(pose.floor).toBeCloseTo(PLATFORM.y, 6)
    // Set down on the deck itself, where the floor agrees with the ride.
    expect(floorAt(WORLD, pose.x, pose.z, pose.floor)).toBe(PLATFORM.y)
    // The cabins swapped ends.
    expect(cableRide.lineT).toBe(1)

    // Back down: the cabin now waiting at the top is the one you board.
    startRide('top', { x: pose.x, z: pose.z, floor: pose.floor })
    while (cableRide.riding && steps < 20_000) {
      pose = stepRide(1 / 60)!
      steps += 1
    }
    expect(pose.floor).toBeCloseTo(GROUND_Y, 6)
    expect(pose.z).toBeCloseTo(CABLE_CAR.landings.base.z, 6)
    expect(cableRide.lineT).toBe(0)
  })
})

test.describe('reconciling a layout with a changed room', () => {
  const ids = BOOKS.map((b) => b.id)
  /** A library somebody has shelved — which is now the only way books get shelved. */
  const saved = {
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
    const result = reconcile(WORLD, { rows: {} }, all, (id) => dims.get(id))
    const shelved = Object.values(result.rows).flat().length
    expect(shelved).toBe(0)
    expect(result.boxed.length).toBe(all.length)
  })
})

test.describe('sorting books into boxes', () => {
  const ids = BOOKS.map((b) => b.id)

  test('a book put in a particular box is in that box on the next load', () => {
    const saved = {
      rows: {},
      boxes: { 'box-3': [ids[0]!, ids[1]!] },
    }
    const result = reconcile(WORLD, saved, ids, lookup)
    expect(result.boxes['box-3']!.slice(0, 2)).toEqual([ids[0], ids[1]])
  })

  test('deleting a box tips its books into the ones that are left', () => {
    const saved = {
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

test.describe('furniture you carry off', () => {
  test('the folding pair stands on the porch, and is portable and useful', () => {
    const folding = WORLD.furniture.filter((item) => PORTABLE.has(item.kind))
    expect(folding.map((item) => item.id).sort()).toEqual(['folding-chair', 'folding-table'])
    for (const item of folding) expect(item.roomId).toBe('porch')

    // Solid wherever they end up, one to sit on and one to put a book on:
    // being ordinary furniture is the whole point of them.
    const chair = folding.find((item) => item.kind === 'foldingchair')!
    const table = folding.find((item) => item.kind === 'foldingtable')!
    expect(SITTABLE.has(chair.kind)).toBe(true)
    expect(table.surface).toBe(true)
    for (const item of folding) expect(FURNITURE_SIZE[item.kind].solid).toBe(true)
  })

  test('setting one down out on the grass is an override, like a shoved box', () => {
    // Carried across the brook and stood at the water's edge: the override is
    // room-local, because that is the frame the document is written in.
    const porch = WORLD.rooms.find((room) => room.id === 'porch')!
    const at: [number, number] = [12 - porch.origin[0], -12 - porch.origin[1]]
    const moved = deriveWorld(DOC, { 'folding-chair': { at, facing: 90, elevation: GROUND_Y } })
    const chair = moved.furniture.find((item) => item.id === 'folding-chair')!
    expect(chair.x).toBeCloseTo(12, 6)
    expect(chair.z).toBeCloseTo(-12, 6)
    expect(chair.y).toBe(GROUND_Y)

    // And it is solid where it now stands, not where the document put it.
    const here = solidsAt(moved.solids, GROUND_Y)
    expect(blocked(here, { x: 12, z: -12 }, 0.2)).toBe(true)
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
    const result = reconcile(bare, { rows: {} }, unshelved, lookup)
    expect(result.boxes).toEqual({})
    // ...but they are still unshelved, and still counted.
    expect([...result.boxed].sort()).toEqual([...unshelved].sort())
    expect(packBoxes(bare, result.boxes, lookup).placed).toEqual([])
  })
})

test.describe('the lake', () => {
  test('the shore you see is the shore you stand at', () => {
    // The renderer builds water from `lakePoint` and the controller refuses
    // steps by `lakeRadius`, so every drawn waterline point must measure as one.
    for (let i = 0; i < 96; i++) {
      const angle = (i / 96) * Math.PI * 2
      const [wx, wz] = lakePoint(angle, 1)
      expect(lakeRadius(wx, wz)).toBeCloseTo(1, 6)
      const [sx, sz] = lakePoint(angle, SHORE_EDGE)
      expect(lakeRadius(sx, sz)).toBeCloseTo(SHORE_EDGE, 6)
    }
  })

  test('the wobble is a pond, not a monster: bounded, and never folding', () => {
    let least = Infinity
    let most = 0
    for (let i = 0; i < 720; i++) {
      const shape = shoreShape((i / 720) * Math.PI * 2)
      least = Math.min(least, shape)
      most = Math.max(most, shape)
    }
    // Small enough that every ring in shoreline units (beach, path, tree line)
    // deforms without crossing its neighbours, and visibly not an ellipse.
    expect(least).toBeGreaterThan(0.85)
    expect(most).toBeLessThan(1.15)
    expect(most - least).toBeGreaterThan(0.05)
  })
})

test.describe('unpacking to the nearest case', () => {
  // The same metric the ordering uses: the climb to another storey weighted double.
  const nearestShelfTo = (x: number, y: number, z: number) =>
    [...WORLD.shelves].sort(
      (a, b) =>
        Math.hypot(a.x - x, 2 * (a.y - y), a.z - z) - Math.hypot(b.x - x, 2 * (b.y - y), b.z - z),
    )[0]!

  test('the case beside the box fills before the one across the room', () => {
    const box = boxesIn(WORLD)[0]!
    const order = nearestRowsFirst(WORLD, {}, box)

    // Every row exactly once, like any fill order.
    expect(new Set(order).size).toBe(order.length)
    expect([...order].sort()).toEqual([...allRowKeys(WORLD)].sort())

    // The order opens with every row of the nearest bookcase, top to bottom.
    const nearest = nearestShelfTo(box.x, box.y, box.z)
    expect(order.slice(0, nearest.rows)).toEqual(
      Array.from({ length: nearest.rows }, (_, row) => `${nearest.id}:${row}`),
    )
  })

  test('a row already holding books goes to the back of the queue', () => {
    const box = boxesIn(WORLD)[0]!
    const nearest = nearestShelfTo(box.x, box.y, box.z)
    const inUse = { [`${nearest.id}:0`]: [BOOKS[0]!.id] }
    const order = nearestRowsFirst(WORLD, inUse, box)
    expect(order.at(-1)).toBe(`${nearest.id}:0`)
    expect(order[0]).toBe(`${nearest.id}:1`)
  })

  test('a storey away is farther than the metres say', () => {
    // Standing under a loft case, whose storey the ordering weights double: a
    // box set down in the great room must not start the unpacking upstairs.
    const upstairs = WORLD.shelves.find((shelf) => shelf.y > 1)!
    const from = { x: upstairs.x, y: 0, z: upstairs.z }
    const order = nearestRowsFirst(WORLD, {}, from)
    const upstairsAt = order.findIndex((key) => parseRowKey(key)!.shelfId === upstairs.id)
    expect(upstairsAt).toBeGreaterThanOrEqual(0)

    const beats = 2 * upstairs.y
    const closerCases = WORLD.shelves.filter(
      (shelf) => shelf.y < 0.01 && Math.hypot(shelf.x - from.x, shelf.z - from.z) < beats,
    )
    expect(closerCases.length).toBeGreaterThan(0)
    const before = new Set(order.slice(0, upstairsAt).map((key) => parseRowKey(key)!.shelfId))
    for (const shelf of closerCases) expect(before.has(shelf.id), `case ${shelf.id}`).toBe(true)
  })
})

test.describe('one box per folder', () => {
  test('bookFolder names the top-level folder under books/', () => {
    expect(bookFolder('C:\\lib\\books\\Fiction\\a.pdf')).toBe('Fiction')
    expect(bookFolder('C:\\lib\\books\\Fiction\\sub\\a.pdf')).toBe('Fiction')
    expect(bookFolder('/home/me/lib/books/Papers/x.epub')).toBe('Papers')
    // A file straight in books/ has no folder to speak of.
    expect(bookFolder('C:\\lib\\books\\a.pdf')).toBe('')
    // No books/ segment at all: the file's own directory is the grouping.
    expect(bookFolder('C:\\stuff\\Novels\\a.pdf')).toBe('Novels')
  })

  test('a folder arrives whole, in one box', () => {
    const sorted = [
      ...Array.from({ length: 12 }, (_, i) => book(`f${i}`, { path: `C:\\l\\books\\Fiction\\f${i}.pdf` })),
      ...Array.from({ length: 9 }, (_, i) => book(`s${i}`, { path: `C:\\l\\books\\Science\\s${i}.pdf` })),
      ...Array.from({ length: 5 }, (_, i) => book(`p${i}`, { path: `C:\\l\\books\\Poetry\\p${i}.pdf` })),
    ]
    const dims = new Map(sorted.map((b) => [b.id, dimensionsFor(b)]))
    const byId = new Map(sorted.map((b) => [b.id, b]))

    const result = reconcile(
      WORLD,
      null,
      sorted.map((b) => b.id),
      (id) => dims.get(id),
      (id) => bookFolder(byId.get(id)!.path),
    )

    // Every folder's books share one box — a folder is never split.
    const homeOf = new Map<string, string>()
    for (const prefix of ['f', 's', 'p']) {
      const homes = new Set(
        Object.entries(result.boxes)
          .filter(([, ids]) => ids.some((id) => id.startsWith(prefix)))
          .map(([boxId]) => boxId),
      )
      expect(homes.size, `folder ${prefix} split across ${homes.size} boxes`).toBe(1)
      homeOf.set(prefix, [...homes][0]!)
    }
    // And nothing was lost in the sorting.
    expect(result.boxed.length).toBe(sorted.length)

    // A box with exactly one folder in it is named after that folder.
    expect(result.folderLabels[homeOf.get('f')!]).toBe('Fiction')
    expect(result.folderLabels[homeOf.get('s')!]).toBe('Science')
    expect(result.folderLabels[homeOf.get('p')!]).toBe('Poetry')
  })

  test('without the option, arrivals still level out book by book', () => {
    const result = reconcile(WORLD, null, BOOKS.map((b) => b.id), lookup)
    const counts = Object.values(result.boxes).map((ids) => ids.length)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    expect(result.folderLabels).toEqual({})
  })

  test('a box shared by two folders — boxes ran short — is left unlabelled', () => {
    // Five subjects, four boxes: one box must take two, and that one gets no name.
    const five = ['A', 'B', 'C', 'D', 'E'].flatMap((subject) =>
      Array.from({ length: 3 }, (_, i) =>
        book(`${subject}${i}`, { path: `C:\\l\\books\\${subject}\\x${i}.pdf` }),
      ),
    )
    const dims = new Map(five.map((b) => [b.id, dimensionsFor(b)]))
    const byId = new Map(five.map((b) => [b.id, b]))

    const result = reconcile(
      WORLD,
      null,
      five.map((b) => b.id),
      (id) => dims.get(id),
      (id) => bookFolder(byId.get(id)!.path),
    )

    const named = Object.values(result.folderLabels)
    expect(named.length).toBe(3)
    expect(new Set(named).size).toBe(3)
  })

  test('root-level files pack together but take no label', () => {
    const loose = Array.from({ length: 3 }, (_, i) => book(`root${i}`, { path: `C:\\l\\books\\r${i}.pdf` }))
    const dims = new Map(loose.map((b) => [b.id, dimensionsFor(b)]))
    const byId = new Map(loose.map((b) => [b.id, b]))

    const result = reconcile(
      WORLD,
      null,
      loose.map((b) => b.id),
      (id) => dims.get(id),
      (id) => bookFolder(byId.get(id)!.path),
    )

    expect(result.folderLabels).toEqual({})
  })
})

test.describe('spawning boxes for One Box per Folder', () => {
  test('a non-positive count asks for nothing', () => {
    expect(planFolderBoxSpots(WORLD, {}, [], 0)).toBeNull()
    expect(planFolderBoxSpots(WORLD, {}, [], -3)).toBeNull()
  })

  test('spawns fresh ids beside the existing pile, in its room', () => {
    const made = planFolderBoxSpots(WORLD, {}, [], 2)
    expect(made).not.toBeNull()
    const existingIds = new Set(boxesIn(WORLD).map((b) => b.id))
    const newIds = Object.keys(made!).filter((id) => !existingIds.has(id))
    expect(newIds.length).toBe(2)

    const room = WORLD.rooms.find((r) => r.id === boxesIn(WORLD)[0]!.roomId)!
    for (const id of newIds) expect(made![id]!.room).toBe(room.id)

    // Each new box sits further along than the last, not on top of it.
    const xs = newIds.map((id) => made![id]!.at[0])
    expect(xs[1]).toBeGreaterThan(xs[0]!)
  })

  test('a big delivery wraps into rows and stays inside the room', () => {
    const made = planFolderBoxSpots(WORLD, {}, [], 40)
    expect(made).not.toBeNull()
    const room = WORLD.rooms.find((r) => r.id === boxesIn(WORLD)[0]!.roomId)!

    const spots = Object.values(made!)
    expect(spots.length).toBe(40)
    for (const spot of spots) {
      expect(Math.abs(spot.at[0])).toBeLessThanOrEqual(room.size[0] / 2)
      expect(Math.abs(spot.at[1])).toBeLessThanOrEqual(room.size[1] / 2)
    }

    // Forty boxes cannot be one line across an eight-metre room.
    const rows = new Set(spots.map((spot) => spot.at[1]))
    expect(rows.size).toBeGreaterThan(1)

    // And no two stand on the same spot.
    const places = new Set(spots.map((spot) => `${spot.at[0]},${spot.at[1]}`))
    expect(places.size).toBe(spots.length)
  })

  test('never reuses an id already standing, spawned, or broken down', () => {
    const made = planFolderBoxSpots(
      WORLD,
      { 'box-5': { room: WORLD.rooms[0]!.id, at: [0, 0], facing: 0 } },
      ['box-6'],
      2,
    )
    expect(made).not.toBeNull()
    const before = new Set(['box-1', 'box-2', 'box-3', 'box-4', 'box-5'])
    const newIds = Object.keys(made!).filter((id) => !before.has(id))
    expect(newIds).not.toContain('box-6')
    expect(new Set(newIds).size).toBe(newIds.length)
  })

  test('falls back to the first room when no box furniture stands anywhere', () => {
    const world = deriveWorld(parseWorldText(DEFAULT_WORLD_TEXT), {}, {
      removed: ['box-1', 'box-2', 'box-3', 'box-4'],
    })
    const made = planFolderBoxSpots(world, {}, ['box-1', 'box-2', 'box-3', 'box-4'], 1)
    expect(made).not.toBeNull()
    const [id] = Object.keys(made!)
    expect(made![id!]!.room).toBe(world.rooms[0]!.id)
  })
})

test.describe('boxes you make up and break down', () => {
  test('a spawned box is real furniture, standing where it was set down', () => {
    const doc = parseWorldText(DEFAULT_WORLD_TEXT)
    const world = deriveWorld(doc, {}, {
      spawned: { 'box-9': { room: 'kitchen', at: [0.5, -0.5], facing: 90 } },
    })

    const spawned = boxesIn(world).find((box) => box.id === 'box-9')
    expect(spawned).toBeDefined()
    const kitchen = doc.rooms.find((room) => room.id === 'kitchen')!
    expect(spawned!.x).toBeCloseTo(kitchen.origin[0] + 0.5, 6)
    expect(spawned!.z).toBeCloseTo(kitchen.origin[1] - 0.5, 6)
    // And books reconcile into it like any other box.
    const result = reconcile(world, null, BOOKS.slice(0, 20).map((b) => b.id), lookup)
    expect(Object.keys(result.boxes)).toContain('box-9')
  })

  test('a spawned box whose room was edited away survives in the first room', () => {
    const world = deriveWorld(parseWorldText(DEFAULT_WORLD_TEXT), {}, {
      spawned: { 'box-9': { room: 'no-such-room', at: [0, 0], facing: 0 } },
    })
    expect(boxesIn(world).some((box) => box.id === 'box-9')).toBe(true)
  })

  test('a broken-down box is gone, and its saved books tip into the others', () => {
    const world = deriveWorld(parseWorldText(DEFAULT_WORLD_TEXT), {}, { removed: ['box-1'] })
    expect(boxesIn(world).some((box) => box.id === 'box-1')).toBe(false)
    // Only boxes break down: the rest of the furniture is untouchable.
    expect(world.furniture.length).toBe(WORLD.furniture.length - 1)

    const ids = BOOKS.slice(0, 10).map((b) => b.id)
    const saved = { rows: {}, boxes: { 'box-1': ids } }
    const result = reconcile(world, saved, ids, lookup)
    expect(result.boxes['box-1']).toBeUndefined()
    expect([...result.boxed].sort()).toEqual([...ids].sort())
  })
})

test.describe('the food delivery', () => {
  test('is left at the foot of the porch steps, on the ground', () => {
    const spot = deliverySpot(WORLD)
    const step = WORLD.furniture.find((item) => item.kind === 'step')!
    // Just past the treads, walking away from the deck…
    expect(Math.hypot(spot.x - step.x, spot.z - step.z)).toBeLessThan(1.0)
    // …and on the grass the steps walk down to, not floating in the decking.
    expect(spot.y).toBeLessThan(step.y)
    expect(spot.y).toBe(terrainAt(spot.x, spot.z))
  })

  test('a map with no steps gets it at the spawn instead', () => {
    const world = worldWith((doc) => {
      for (const room of doc.rooms) {
        room.furniture = room.furniture.filter((item) => item.kind !== 'step')
      }
    })
    const spot = deliverySpot(world)
    expect(Math.hypot(spot.x - world.spawn.x, spot.z - world.spawn.z)).toBeLessThan(1.0)
  })
})

test.describe('the camp and the front door', () => {
  test('the camp pad is real floor, across the water', () => {
    const camp = WORLD.rooms.find((room) => room.id === 'camp')!
    expect(camp.outdoor).toBe(true)
    // Standing on the pad: the floor under you is the pad, not the grass.
    expect(floorAt(WORLD, camp.origin[0], camp.origin[1], 0)).toBeCloseTo(camp.elevation, 6)
    // Genuinely across the lake: past the walk that rings it.
    expect(lakeRadius(camp.origin[0], camp.origin[1])).toBeGreaterThan(PATH.to)
    // The fire is a lamp to the machinery, so E can light it.
    expect(WORLD.lights.some((lamp) => lamp.kind === 'campfire')).toBe(true)
  })

  test('the front door hangs in the wall line of the south doorway', () => {
    const door = WORLD.furniture.find((item) => item.kind === 'door')
    expect(door).toBeDefined()
    // In the wall's thickness, not standing in the room.
    expect(door!.z).toBeGreaterThan(3.99)
    expect(door!.z).toBeLessThan(4.13)
  })
})
