import { aabbFromCentre, type Aabb } from '../scene/collision'
import type {
  FloorHole,
  FurnitureKind,
  FurnitureSpec,
  Opening,
  RoomSpec,
  Wall,
  WorldDocument,
} from './schema'

/**
 * Turning the world document into the things the scene and the walk controller
 * actually need: wall panels with holes cut in them, floor slabs with the
 * stairwell taken out, shelf transforms, colliders, and the height of the floor
 * under any point.
 *
 * All of it is derived — nothing here is stored — so an edit to `library.json`
 * is a full recompute rather than a patch. That is what makes live reload safe:
 * there is no incremental path that can drift from the file.
 */

/** Metres. Walls are drawn *outward* from the room's floor bounds. */
export const WALL = 0.12
export const SKIRTING = { height: 0.11, depth: 0.02 }
/** How thick a floor slab is. It is also the ceiling of whatever is beneath it. */
export const FLOOR_SLAB = 0.22

/**
 * Two rooms are joined by placing them `2 * WALL` apart, so their wall slabs sit
 * flush against each other and a door in both walls makes a short doorway.
 */
export const ROOM_GAP = 2 * WALL

/**
 * Footprint and height for each furniture kind, and whether you bump into it.
 *
 * `surface` is the height of the top you can put a book down on, as a fraction
 * of the piece's height — 0 for anything you cannot. A rug is not a surface: a
 * book left on one is on the floor, which is where the physics puts it anyway.
 */
export const FURNITURE_SIZE: Record<
  FurnitureKind,
  { width: number; depth: number; height: number; solid: boolean; surface: boolean }
> = {
  armchair: { width: 0.86, depth: 0.9, height: 0.98, solid: true, surface: false },
  sofa: { width: 1.86, depth: 0.9, height: 0.86, solid: true, surface: false },
  diningchair: { width: 0.46, depth: 0.48, height: 0.92, solid: true, surface: false },
  bench: { width: 1.3, depth: 0.38, height: 0.44, solid: true, surface: true },
  footstool: { width: 0.5, depth: 0.42, height: 0.38, solid: true, surface: true },
  sidetable: { width: 0.46, depth: 0.46, height: 0.56, solid: true, surface: true },
  table: { width: 1.3, depth: 0.78, height: 0.74, solid: true, surface: true },
  // A surface, so a book can be left on the covers — where books end up.
  bed: { width: 1.5, depth: 2.05, height: 0.55, solid: true, surface: true },
  box: { width: 0.52, depth: 0.4, height: 0.36, solid: true, surface: false },
  recordshelf: { width: 0.9, depth: 0.36, height: 0.78, solid: true, surface: true },
  kitchencounter: { width: 1.8, depth: 0.62, height: 0.92, solid: true, surface: true },
  recordplayer: { width: 0.46, depth: 0.38, height: 0.18, solid: false, surface: false },
  coffeemaker: { width: 0.24, depth: 0.28, height: 0.36, solid: false, surface: false },
  fireplace: { width: 1.2, depth: 0.5, height: 1.5, solid: true, surface: false },
  floorlamp: { width: 0.36, depth: 0.36, height: 1.66, solid: true, surface: false },
  pendant: { width: 0.3, depth: 0.3, height: 0.3, solid: false, surface: false },
  rug: { width: 2.2, depth: 1.6, height: 0.012, solid: false, surface: false },
  plant: { width: 0.42, depth: 0.42, height: 0.95, solid: true, surface: false },
  picture: { width: 0.6, depth: 0.05, height: 0.8, solid: false, surface: false },
  stairs: { width: 1.0, depth: 3.0, height: 2.6, solid: false, surface: false },
}

/** Furniture you can sit in. A footstool is for feet. */
export const SITTABLE = new Set<FurnitureKind>(['armchair', 'sofa', 'diningchair', 'bench', 'bed'])

/** Furniture that emits light, and can therefore be switched. */
export const LAMPS = new Set<FurnitureKind>(['floorlamp', 'pendant', 'fireplace'])

/** Furniture you operate rather than sit on or fill: press E and something happens. */
export const APPLIANCES = new Set<FurnitureKind>(['recordplayer', 'coffeemaker'])

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }

export function roomBounds(room: RoomSpec): Bounds {
  const [cx, cz] = room.origin
  const [w, d] = room.size
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }
}

/** A box, ready to hand straight to a `<boxGeometry>`. */
export type Panel = {
  position: [number, number, number]
  size: [number, number, number]
}

/**
 * A collider with a vertical extent.
 *
 * The 2D `Aabb` the walk controller uses is still what the sliding maths runs
 * on — see `collision.ts`, which stays a few dozen lines of arithmetic — but
 * with a loft over the living room, "is there a wall here" now depends on which
 * floor you are standing on. So the world derives solids with a top and a
 * bottom, and the controller flattens the ones at its own height.
 */
export type Solid = Aabb & { bottom: number; top: number }

const solidFrom = (box: Aabb, bottom: number, top: number): Solid => ({ ...box, bottom, top })

/** How long a wall is, and which axis it runs along. */
const wallAxis = (wall: Wall): 'x' | 'z' => (wall === 'north' || wall === 'south' ? 'x' : 'z')

function wallLength(room: RoomSpec, wall: Wall): number {
  return wallAxis(wall) === 'x' ? room.size[0] : room.size[1]
}

/** Where the wall slab's centre line sits, on the axis it faces. */
function wallOffset(room: RoomSpec, wall: Wall): number {
  const bounds = roomBounds(room)
  switch (wall) {
    case 'north':
      return bounds.minZ - WALL / 2
    case 'south':
      return bounds.maxZ + WALL / 2
    case 'west':
      return bounds.minX - WALL / 2
    case 'east':
      return bounds.maxX + WALL / 2
  }
}

/** Position a box given its span along the wall and its span in height. */
function wallPanel(
  room: RoomSpec,
  wall: Wall,
  from: number,
  to: number,
  bottom: number,
  top: number,
): Panel | null {
  if (to - from <= 1e-6 || top - bottom <= 1e-6) return null

  const along = (from + to) / 2
  const length = to - from
  const y = room.elevation + (bottom + top) / 2
  const height = top - bottom
  const offset = wallOffset(room, wall)
  const [cx, cz] = room.origin

  return wallAxis(wall) === 'x'
    ? { position: [cx + along, y, offset], size: [length, height, WALL] }
    : { position: [offset, y, cz + along], size: [WALL, height, length] }
}

const openingsOn = (room: RoomSpec, wall: Wall): Opening[] =>
  room.openings.filter((o) => o.wall === wall).sort((a, b) => a.at - b.at)

/** Only the walls this room actually builds. A porch builds none. */
export const wallsOf = (room: RoomSpec): Wall[] => room.walls

/**
 * One wall, as the boxes left over once its openings are cut out: full-height
 * piers between openings, plus the apron below a window and the lintel above
 * anything that does not reach the ceiling.
 */
export function wallPanels(room: RoomSpec, wall: Wall): Panel[] {
  if (!room.walls.includes(wall)) return []
  const length = wallLength(room, wall)
  const half = length / 2
  const panels: (Panel | null)[] = []

  let cursor = -half
  for (const opening of openingsOn(room, wall)) {
    const from = Math.max(-half, opening.at - opening.width / 2)
    const to = Math.min(half, opening.at + opening.width / 2)
    panels.push(wallPanel(room, wall, cursor, from, 0, room.height))
    panels.push(wallPanel(room, wall, from, to, 0, opening.sill))
    panels.push(wallPanel(room, wall, from, to, opening.sill + opening.height, room.height))
    cursor = Math.max(cursor, to)
  }
  panels.push(wallPanel(room, wall, cursor, half, 0, room.height))

  return panels.filter((panel): panel is Panel => panel !== null)
}

/** The glazing itself, so a window reads as glass rather than as a hole. */
export function windowPanes(room: RoomSpec): Panel[] {
  const panes: Panel[] = []
  for (const wall of wallsOf(room)) {
    for (const opening of openingsOn(room, wall)) {
      if (opening.kind !== 'window' || !opening.glazed) continue
      const panel = wallPanel(
        room,
        wall,
        opening.at - opening.width / 2,
        opening.at + opening.width / 2,
        opening.sill,
        opening.sill + opening.height,
      )
      if (panel) panes.push(panel)
    }
  }
  return panes
}

export const WALLS: readonly Wall[] = ['north', 'south', 'east', 'west']

/**
 * Colliders for this room's walls: the whole length, minus the doors.
 *
 * A window's apron still blocks you — it is a waist-high wall — so only
 * openings you could actually walk through are subtracted. That is also what
 * makes a loft balustrade work: a wide "window" with a metre-high sill is
 * something you can see the room over and cannot walk off.
 */
export function wallSolids(room: RoomSpec): Solid[] {
  const boxes: Solid[] = []

  for (const wall of wallsOf(room)) {
    const length = wallLength(room, wall)
    const half = length / 2
    const doors = openingsOn(room, wall).filter((o) => o.kind === 'door' && o.sill < 0.2)

    let cursor = -half
    const spans: [number, number][] = []
    for (const door of doors) {
      spans.push([cursor, Math.max(cursor, door.at - door.width / 2)])
      cursor = Math.max(cursor, door.at + door.width / 2)
    }
    spans.push([cursor, half])

    for (const [from, to] of spans) {
      const panel = wallPanel(room, wall, from, to, 0, room.height)
      if (!panel) continue
      const [x, , z] = panel.position
      const [w, , d] = panel.size
      boxes.push(
        solidFrom(aabbFromCentre(x, z, w, d), room.elevation, room.elevation + room.height),
      )
    }
  }

  return boxes
}

// ---- floors -------------------------------------------------------------

/** A floor rectangle, in world metres. */
export type Slab = Bounds & { y: number }

const EPS = 1e-6

/** `rect` with `hole` taken out of it, as up to four rectangles. */
function subtract(rect: Bounds, hole: Bounds): Bounds[] {
  const overlaps =
    hole.minX < rect.maxX - EPS &&
    hole.maxX > rect.minX + EPS &&
    hole.minZ < rect.maxZ - EPS &&
    hole.maxZ > rect.minZ + EPS
  if (!overlaps) return [rect]

  const out: Bounds[] = []
  const cutMinX = Math.max(rect.minX, hole.minX)
  const cutMaxX = Math.min(rect.maxX, hole.maxX)

  if (hole.minZ > rect.minZ + EPS) {
    out.push({ minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: hole.minZ })
  }
  if (hole.maxZ < rect.maxZ - EPS) {
    out.push({ minX: rect.minX, maxX: rect.maxX, minZ: hole.maxZ, maxZ: rect.maxZ })
  }
  const bandMinZ = Math.max(rect.minZ, hole.minZ)
  const bandMaxZ = Math.min(rect.maxZ, hole.maxZ)
  if (cutMinX > rect.minX + EPS) {
    out.push({ minX: rect.minX, maxX: cutMinX, minZ: bandMinZ, maxZ: bandMaxZ })
  }
  if (cutMaxX < rect.maxX - EPS) {
    out.push({ minX: cutMaxX, maxX: rect.maxX, minZ: bandMinZ, maxZ: bandMaxZ })
  }
  return out
}

const holeBounds = (room: RoomSpec, hole: FloorHole): Bounds => ({
  minX: room.origin[0] + hole.at[0] - hole.size[0] / 2,
  maxX: room.origin[0] + hole.at[0] + hole.size[0] / 2,
  minZ: room.origin[1] + hole.at[1] - hole.size[1] / 2,
  maxZ: room.origin[1] + hole.at[1] + hole.size[1] / 2,
})

/**
 * The room's floor, as rectangles with its stairwells missing.
 *
 * A loft needs a hole for the stair to come up through, and a floor is exactly
 * the sort of thing that must not be approximated: you stand on it.
 *
 * The floor runs out to the *outside* of each wall the room actually builds,
 * rather than stopping at the room's inner face, because a wall stands on the
 * floor rather than beside it. That is not a detail: two rooms are joined by
 * placing them `2 * WALL` apart, so without it there is a 24 cm strip of
 * nothing in every doorway in the building — which the walk controller reads,
 * correctly, as a hole to refuse to step into.
 *
 * Only under walls it builds, though. A porch butted flush against the cabin
 * has no north wall of its own, and a floor that ran out under one anyway would
 * be a second slab at exactly the height of the cabin's, in the open, fighting
 * it for every pixel.
 */
export function floorSlabs(room: RoomSpec): Slab[] {
  const inner = roomBounds(room)
  const under = (wall: Wall) => (room.walls.includes(wall) ? WALL : 0)
  let rects: Bounds[] = [
    {
      minX: inner.minX - under('west'),
      maxX: inner.maxX + under('east'),
      minZ: inner.minZ - under('north'),
      maxZ: inner.maxZ + under('south'),
    },
  ]
  for (const hole of room.holes) {
    const cut = holeBounds(room, hole)
    rects = rects.flatMap((rect) => subtract(rect, cut))
  }
  return rects.map((rect) => ({ ...rect, y: room.elevation }))
}

const inside = (b: Bounds, x: number, z: number) =>
  x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ

// ---- shelves and furniture ---------------------------------------------

export type DerivedShelf = {
  id: string
  roomId: string
  /** World position of the unit's origin, at its own floor level. */
  x: number
  y: number
  z: number
  rotationY: number
  rows: number
  label: string | null
}

export type DerivedFurniture = FurnitureSpec & {
  roomId: string
  x: number
  /**
   * World height of the piece's base — normally its room's floor, raised by
   * `y` for something standing on something else (a coffee maker on a counter)
   * and by rather more for a picture, whose `y` names the centre of the frame.
   */
  y: number
  z: number
  rotationY: number
  width: number
  depth: number
  height: number
  /** True if you can put something down on top of it. */
  surface: boolean
}

/** A flight of stairs, resolved to the ramp the walk controller climbs. */
export type DerivedStair = {
  id: string
  bounds: Bounds
  /** Floor height at the bottom of the run and at the top. */
  bottom: number
  top: number
  /** Unit vector, in plan, pointing up the flight. */
  dx: number
  dz: number
  /** Length of the run in that direction. */
  run: number
  x: number
  z: number
  rotationY: number
  width: number
}

export type DerivedLight = {
  id: string
  kind: FurnitureKind
  roomId: string
  x: number
  y: number
  z: number
  defaultOn: boolean
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Where a piece's base sits, in world metres.
 *
 * `y` in the document means "how far off this room's floor", which is what you
 * want for a coffee maker standing on a counter. Two kinds read it differently
 * because two kinds do not stand on the floor at all: a picture's `y` is the
 * centre of the frame, which is how anybody hanging one thinks about it, and a
 * pendant hangs from the ceiling rather than rising from the boards.
 */
function mountHeight(room: RoomSpec, item: FurnitureSpec, height: number): number {
  if (item.kind === 'picture') return room.elevation + (item.y ?? 1.55) - height / 2
  if (item.kind === 'pendant') return room.elevation + (item.y ?? room.height - 0.75)
  return room.elevation + (item.y ?? 0)
}

export type DerivedWorld = {
  doc: WorldDocument
  rooms: RoomSpec[]
  /** Document order, which is the order the renderer instances them in. */
  shelves: DerivedShelf[]
  shelfIndex: Map<string, number>
  furniture: DerivedFurniture[]
  stairs: DerivedStair[]
  lights: DerivedLight[]
  /** Every solid, with its vertical extent. Filter by level before colliding. */
  solids: Solid[]
  /** Flattened solids, ignoring level. Handy for tests and single-storey rooms. */
  colliders: Aabb[]
  /** Floor rectangles with the stairwells cut out, for standing on. */
  slabs: Slab[]
  spawn: { x: number; y: number; z: number; yaw: number }
}

/**
 * Where a piece of furniture is allowed to be, overriding the document.
 *
 * Only the moving boxes use this — you can shove one across the room and it
 * stays where you left it — and it is kept out of `library.json` on purpose:
 * that file is yours, and the app writing your furniture back into it would
 * mean your comments and your formatting were at the mercy of a shove.
 *
 * `elevation` is the floor the box was set down on. Optional because older
 * saves lack it; without it the box stands at its document room's storey,
 * which is wrong exactly when it was carried up or down a flight of stairs.
 */
export type FurnitureOverride = { at: [number, number]; facing: number; elevation?: number }

export function deriveWorld(
  doc: WorldDocument,
  overrides: Record<string, FurnitureOverride> = {},
): DerivedWorld {
  const shelves: DerivedShelf[] = []
  const furniture: DerivedFurniture[] = []
  const stairs: DerivedStair[] = []
  const lights: DerivedLight[] = []
  const solids: Solid[] = []
  const slabs: Slab[] = []

  for (const room of doc.rooms) {
    const [ox, oz] = room.origin
    solids.push(...wallSolids(room))
    slabs.push(...floorSlabs(room))

    for (const shelf of room.shelves) {
      const rotationY = radians(shelf.facing)
      shelves.push({
        id: shelf.id,
        roomId: room.id,
        x: ox + shelf.at[0],
        y: room.elevation,
        z: oz + shelf.at[1],
        rotationY,
        rows: shelf.rows,
        label: shelf.label ?? null,
      })
    }

    for (const item of room.furniture) {
      const base = FURNITURE_SIZE[item.kind]
      const override = overrides[item.id]
      const at = override?.at ?? item.at
      const facing = override?.facing ?? item.facing

      const width = item.size?.[0] ?? base.width
      const depth = item.kind === 'picture' ? base.depth : (item.size?.[1] ?? base.depth)
      const height =
        item.kind === 'picture'
          ? (item.size?.[1] ?? base.height)
          : (item.height ?? base.height)
      const rotationY = radians(facing)
      const baseY = override?.elevation ?? mountHeight(room, item, height)

      const derived: DerivedFurniture = {
        ...item,
        at,
        facing,
        roomId: room.id,
        x: ox + at[0],
        y: baseY,
        z: oz + at[1],
        rotationY,
        width,
        depth,
        height,
        surface: base.surface,
      }
      furniture.push(derived)

      if (base.solid) {
        solids.push(
          solidFrom(
            aabbFromCentre(derived.x, derived.z, width, depth, rotationY),
            baseY,
            baseY + height,
          ),
        )
      }

      if (LAMPS.has(item.kind)) {
        lights.push({
          id: item.id,
          kind: item.kind,
          roomId: room.id,
          x: derived.x,
          // Where the bulb is, not where the fitting starts: a floor lamp lights
          // from its shade and a pendant from just under its own body.
          y: baseY + (item.kind === 'floorlamp' ? 1.44 : item.kind === 'fireplace' ? 0.4 : 0.12),
          z: derived.z,
          defaultOn: item.on ?? true,
        })
      }

      if (item.kind === 'stairs') {
        const run = item.size?.[1] ?? base.depth
        const rise = item.rise ?? base.height
        // The flight climbs towards its facing direction, which is the same
        // convention as a bookcase's open front: 0 is +Z.
        const dx = Math.sin(rotationY)
        const dz = Math.cos(rotationY)
        const halfRun = run / 2
        const halfWide = width / 2
        stairs.push({
          id: item.id,
          bounds: {
            // Summed, not the max of the two terms: that is the AABB of a
            // rotated rectangle, and the schema accepts any facing. With max,
            // a 45° flight lost its corners — `stairProgress` returned null on
            // real treads and the walk refused the step. (For axis-aligned
            // flights one term is zero, so nothing changes.)
            minX: derived.x - (Math.abs(dx) * halfRun + Math.abs(dz) * halfWide),
            maxX: derived.x + (Math.abs(dx) * halfRun + Math.abs(dz) * halfWide),
            minZ: derived.z - (Math.abs(dz) * halfRun + Math.abs(dx) * halfWide),
            maxZ: derived.z + (Math.abs(dz) * halfRun + Math.abs(dx) * halfWide),
          },
          bottom: room.elevation,
          top: room.elevation + rise,
          dx,
          dz,
          run,
          x: derived.x,
          z: derived.z,
          rotationY,
          width,
        })
      }
    }
  }

  const spawnRoom = doc.rooms.find((room) => room.id === doc.spawn.room) ?? doc.rooms[0]!
  const spawn = {
    x: spawnRoom.origin[0] + doc.spawn.at[0],
    y: spawnRoom.elevation,
    z: spawnRoom.origin[1] + doc.spawn.at[1],
    yaw: radians(doc.spawn.facing),
  }

  return {
    doc,
    rooms: doc.rooms,
    shelves,
    shelfIndex: new Map(shelves.map((shelf, i) => [shelf.id, i])),
    furniture,
    stairs,
    lights,
    solids,
    colliders: solids,
    slabs,
    spawn,
  }
}

/**
 * Which room a world position is in, if any.
 *
 * `near` disambiguates a loft from the room under it: with two floors over the
 * same plan, "which room am I in" is only answerable if you say how high up you
 * are. Callers that genuinely do not care pass nothing and get the lowest.
 */
export function roomAt(
  world: DerivedWorld,
  x: number,
  z: number,
  near?: number,
): RoomSpec | null {
  let best: RoomSpec | null = null
  let bestGap = Infinity
  for (const room of world.rooms) {
    if (!inside(roomBounds(room), x, z)) continue
    if (near === undefined) {
      // No height given: keep looking and answer with the lowest, as the
      // contract says — returning the first match handed out the loft for
      // ground-floor positions in any document that listed it first.
      if (best === null || room.elevation < best.elevation) best = room
      continue
    }
    const gap = Math.abs(room.elevation - near)
    if (gap < bestGap) {
      bestGap = gap
      best = room
    }
  }
  return best
}

/** How far up a flight you are, 0 at the bottom step and 1 at the landing. */
function stairProgress(stair: DerivedStair, x: number, z: number): number | null {
  if (!inside(stair.bounds, x, z)) return null
  const along = (x - stair.x) * stair.dx + (z - stair.z) * stair.dz
  const across = (x - stair.x) * stair.dz - (z - stair.z) * stair.dx
  if (Math.abs(across) > stair.width / 2) return null
  const t = along / stair.run + 0.5
  return Math.max(0, Math.min(1, t))
}

/**
 * The height of the floor under a point — the single answer to "what am I
 * standing on", used by the walk controller and by anything you drop.
 *
 * `from` is the level you are already at, because with a loft over a living
 * room there is more than one floor under your feet and the right one is the
 * nearest one at or below you. A point over a stairwell has no floor at loft
 * level at all: the answer is the floor two and a half metres down, which the
 * controller then refuses to step off.
 */
export function floorAt(world: DerivedWorld, x: number, z: number, from = 0): number | null {
  let best: number | null = null

  for (const stair of world.stairs) {
    const t = stairProgress(stair, x, z)
    if (t === null) continue
    const y = stair.bottom + (stair.top - stair.bottom) * t
    // A flight is reachable from either end, so it is a candidate whenever it
    // is anywhere near the level you are on.
    if (y <= from + STEP_UP && (best === null || y > best)) best = y
  }

  for (const slab of world.slabs) {
    if (!inside(slab, x, z)) continue
    if (slab.y <= from + STEP_UP && (best === null || slab.y > best)) best = slab.y
  }

  return best
}

/** How big a step up you can take without stairs: a threshold, not a wall. */
export const STEP_UP = 0.42

/**
 * The height of whatever a dropped book would land on: the floor, or the top of
 * a table if it is over one.
 */
export function supportAt(world: DerivedWorld, x: number, z: number, from: number): number {
  let best = floorAt(world, x, z, from) ?? 0

  for (const item of world.furniture) {
    if (!item.surface) continue
    const box = aabbFromCentre(item.x, item.z, item.width, item.depth, item.rotationY)
    if (!inside(box, x, z)) continue
    const top = item.y + item.height
    if (top <= from + 0.02 && top > best) best = top
  }

  return best
}

/** The solids that matter to someone standing at `floorY`, flattened to 2D. */
export function collidersOn(world: DerivedWorld, floorY: number, headroom = 1.7): Aabb[] {
  const feet = floorY + 0.1
  const head = floorY + headroom
  return world.solids.filter((solid) => solid.top > feet && solid.bottom < head)
}
