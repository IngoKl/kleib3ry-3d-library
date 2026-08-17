import { aabbFromCentre, type Aabb } from '../scene/collision'
import { CLEARING, growForest, treeSolids, type Tree } from './forest'
import { terrainAt } from './terrain'
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
 * Footprint and height per furniture kind, and whether you bump into it.
 * `surface` is the height a book can be put down at, as a fraction of the
 * piece's height, or 0 for anything that takes none.
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
  // Deeper than a dining table and a little higher: a desk is somewhere you
  // spread a book open and leave it, which is what makes it a surface.
  desk: { width: 1.5, depth: 0.72, height: 0.75, solid: true, surface: true },
  // A surface, so a book can be left on the covers — where books end up.
  bed: { width: 1.5, depth: 2.05, height: 0.55, solid: true, surface: true },
  // The two you can pick up and carry off. Light enough to want to: a slat
  // chair and a trestle table, both narrower than the porch door they live
  // beside. They are ordinary furniture in every other respect — you sit on the
  // one and put a book down on the other — and that is the point of them.
  foldingchair: { width: 0.46, depth: 0.5, height: 0.88, solid: true, surface: false },
  foldingtable: { width: 0.86, depth: 0.58, height: 0.7, solid: true, surface: true },
  box: { width: 0.52, depth: 0.4, height: 0.36, solid: true, surface: false },
  // Flattened boxes leaning against a wall, waiting to be made up. E takes one
  // — see `spawnBox` — which is how a room gets more boxes than the document
  // put in it.
  boxstack: { width: 0.6, depth: 0.3, height: 0.62, solid: true, surface: false },
  recordshelf: { width: 0.9, depth: 0.36, height: 0.78, solid: true, surface: true },
  // Long, shallow and open-topped: the tapes stand in it spine-out, and it has
  // to be lower than they are tall or a box of tapes shows you nothing but its
  // own sides. A tape is 23 cm, so 22 leaves the labels standing proud.
  tapecrate: { width: 0.56, depth: 0.22, height: 0.22, solid: true, surface: true },
  kitchencounter: { width: 1.8, depth: 0.62, height: 0.92, solid: true, surface: true },
  // A surface, so the deck in the bathroom has somewhere honest to stand and a
  // book put down on the edge of the bath stays where a book put down there does.
  bathtub: { width: 1.7, depth: 0.76, height: 0.56, solid: true, surface: true },
  toilet: { width: 0.4, depth: 0.68, height: 0.78, solid: true, surface: false },
  basin: { width: 0.6, depth: 0.44, height: 0.86, solid: true, surface: true },
  recordplayer: { width: 0.46, depth: 0.38, height: 0.18, solid: false, surface: false },
  // A portable television, which is to say a heavy one: deep, because the tube
  // is, and solid because it stands on the floor on its own stand.
  crt: { width: 0.6, depth: 0.56, height: 0.52, solid: true, surface: false },
  coffeemaker: { width: 0.24, depth: 0.28, height: 0.36, solid: false, surface: false },
  // The catalogue terminal: a monitor on a box, with a keyboard in front of it.
  // Not solid — it stands on a desk, and a collider on a desk is a collider you
  // walk into standing beside the desk.
  computer: { width: 0.46, depth: 0.44, height: 0.44, solid: false, surface: false },
  // A pad of notes. Small enough that its footprint is only ever used to work
  // out where the crosshair has to be pointing.
  postits: { width: 0.13, depth: 0.13, height: 0.035, solid: false, surface: false },
  // A whiteboard marker, lying wherever it was left. Its footprint is only ever
  // used to work out whether the crosshair is on it.
  marker: { width: 0.14, depth: 0.06, height: 0.05, solid: false, surface: false },
  // The telephone. Not solid — it stands on a counter, like the coffee maker.
  phone: { width: 0.24, depth: 0.17, height: 0.16, solid: false, surface: false },
  fridge: { width: 0.62, depth: 0.62, height: 1.58, solid: true, surface: false },
  bin: { width: 0.34, depth: 0.34, height: 0.42, solid: true, surface: false },
  // The headlamp, lying wherever `y` puts it — on the porch table, by default.
  headlamp: { width: 0.16, depth: 0.14, height: 0.08, solid: false, surface: false },
  // A hinged leaf standing in a doorway. Not solid *here*: whether it blocks
  // depends on whether it is shut, which is ambience state — the walk
  // controller adds a collider for a closed one itself.
  door: { width: 1.0, depth: 0.1, height: 2.02, solid: false, surface: false },
  // An A-frame shelter. Solid: canvas is not something to walk through.
  tent: { width: 1.9, depth: 2.2, height: 1.5, solid: true, surface: false },
  campfire: { width: 0.95, depth: 0.95, height: 0.4, solid: true, surface: false },
  // An upright cabinet: person-height, deep enough to house a tube, and solid
  // because it stands on the floor and you walk up to its front.
  arcade: { width: 0.72, depth: 0.78, height: 1.75, solid: true, surface: false },
  // The crate of game cartridges beside it. Low, so it never hides the wall
  // behind it. Not a surface: it is open-topped, and it is an appliance — a
  // piece in both the fixtures and the surfaces group would be drawn twice.
  rombox: { width: 0.5, depth: 0.34, height: 0.46, solid: true, surface: false },
  fireplace: { width: 1.2, depth: 0.5, height: 1.5, solid: true, surface: false },
  floorlamp: { width: 0.36, depth: 0.36, height: 1.66, solid: true, surface: false },
  pendant: { width: 0.3, depth: 0.3, height: 0.3, solid: false, surface: false },
  // A string of bulbs. `size` is [length, sag] and `y` is the height it is
  // strung at, so it runs along whatever it is hung across.
  fairylights: { width: 3.0, depth: 0.08, height: 0.2, solid: false, surface: false },
  // A plate on the wall. Its footprint is only used to find the crosshair.
  lightswitch: { width: 0.09, depth: 0.03, height: 0.13, solid: false, surface: false },
  rug: { width: 2.2, depth: 1.6, height: 0.012, solid: false, surface: false },
  plant: { width: 0.42, depth: 0.42, height: 0.95, solid: true, surface: false },
  picture: { width: 0.6, depth: 0.05, height: 0.8, solid: false, surface: false },
  whiteboard: { width: 1.8, depth: 0.06, height: 1.1, solid: false, surface: false },
  clock: { width: 0.34, depth: 0.06, height: 0.34, solid: false, surface: false },
  stairs: { width: 1.0, depth: 3.0, height: 2.6, solid: false, surface: false },
  // A pair of treads hanging off the edge of a deck. Not solid: the whole point
  // is to walk down it, and the walk controller reads the *floor*, not the
  // joinery — a 24 cm drop is inside `STEP_UP` and needs no ramp.
  step: { width: 1.4, depth: 0.62, height: 0.24, solid: false, surface: false },
}

/**
 * Furniture that hangs on a wall. Three things follow: `size` is width by
 * *height*, `y` is the centre rather than the base, and depth comes from the
 * kind rather than the document.
 */
export const WALL_MOUNTED = new Set<FurnitureKind>([
  'picture',
  'whiteboard',
  'clock',
  'lightswitch',
])

/** Furniture you can sit in. A footstool is for feet. */
export const SITTABLE = new Set<FurnitureKind>([
  'armchair',
  'sofa',
  'diningchair',
  'bench',
  'bed',
  'foldingchair',
])

/**
 * Furniture `X` picks up and carries off. A moving box is not on the list: it
 * has its own verbs and its own `X` handling.
 *
 * A carried piece is stored like a shoved box, as a `FurnitureOverride` in
 * `books.json` — the document says where it lives, the override where you left
 * it.
 */
export const PORTABLE = new Set<FurnitureKind>(['foldingchair', 'foldingtable'])

/** Furniture that emits light, and can therefore be switched. */
export const LAMPS = new Set<FurnitureKind>([
  'floorlamp',
  'pendant',
  'fireplace',
  'fairylights',
  'campfire',
])

/** Furniture you operate rather than sit on or fill: press E and something happens. */
export const APPLIANCES = new Set<FurnitureKind>([
  'recordplayer',
  'crt',
  'coffeemaker',
  'computer',
  'postits',
  'marker',
  'lightswitch',
  'boxstack',
  'phone',
  'fridge',
  'bin',
  'headlamp',
  'door',
  'arcade',
  'rombox',
])

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
 * A collider with a vertical extent. The sliding maths still runs on the 2D
 * `Aabb` in `collision.ts`, but with a loft over the living room "is there a
 * wall here" depends on which floor you stand on — so solids carry a top and a
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

/** The hole each of a room's openings leaves, whether or not it is filled. */
export function openingPanels(room: RoomSpec): { panel: Panel; opening: Opening }[] {
  const out: { panel: Panel; opening: Opening }[] = []
  for (const wall of wallsOf(room)) {
    for (const opening of openingsOn(room, wall)) {
      const panel = wallPanel(
        room,
        wall,
        opening.at - opening.width / 2,
        opening.at + opening.width / 2,
        opening.sill,
        opening.sill + opening.height,
      )
      if (panel) out.push({ panel, opening })
    }
  }
  return out
}

/** The glazing itself, so a window reads as glass rather than as a hole. */
export function windowPanes(room: RoomSpec): Panel[] {
  return openingPanels(room)
    .filter(({ opening }) => opening.kind === 'window' && opening.glazed)
    .map(({ panel }) => panel)
}

/**
 * Where a room's openings are, and whether anything is in them. For anything
 * that needs to know how open a room is — chiefly the rain you can hear.
 */
export type OpeningSpot = {
  x: number
  y: number
  z: number
  glazed: boolean
  kind: Opening['kind']
  wall: Wall
}

export function openingSpots(room: RoomSpec): OpeningSpot[] {
  return openingPanels(room).map(({ panel, opening }) => ({
    x: panel.position[0],
    y: panel.position[1],
    z: panel.position[2],
    glazed: opening.glazed,
    kind: opening.kind,
    wall: opening.wall,
  }))
}

export const WALLS: readonly Wall[] = ['north', 'south', 'east', 'west']

/**
 * Colliders for this room's walls: the whole length, minus the doors. Only
 * openings you could walk through are subtracted — a window's apron is a
 * waist-high wall, which is also what makes a loft balustrade work.
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

// ---- roofs --------------------------------------------------------------

/**
 * A roof, resolved to the two heights and one footprint the renderer needs.
 *
 * The plane passes through the eaves at the *top of the walls* and rises from
 * there, never below — which is what keeps a porch roof from cutting through
 * the porch ceiling it is supposed to sit on. The overhang is the one part that
 * dips under the eaves line, and it does that outside the walls where there is
 * nothing to intersect.
 */
export type DerivedRoof = {
  roomId: string
  kind: 'gable' | 'shed' | 'flat'
  /** The low side. For a gable, the eaves run along this wall and its opposite. */
  fall: Wall
  /** 'z' when the slope falls along Z, i.e. the ridge runs east to west. */
  axis: 'x' | 'z'
  /** The walls, in world metres — where the gable ends stand. */
  walls: Bounds
  /** The same, grown by the overhang: what the roof actually covers. */
  covers: Bounds
  /** Height of the eaves, and of the ridge (or of the high side of a shed). */
  eaves: number
  peak: number
  /** Radians, so the renderer can tip a slab by exactly the derived rise. */
  pitch: number
  overhang: number
}

const areaOf = (room: RoomSpec) => room.size[0] * room.size[1]
const topOf = (room: RoomSpec) => room.elevation + room.height

/**
 * The highest point a room's own roof can reach. What the overhang rule has to
 * clear: a neighbour's slope rises far above its wall plate.
 */
function roofTopOf(room: RoomSpec): number {
  const top = topOf(room)
  if (room.roof.kind === 'none' || room.roof.kind === 'flat') return top
  const b = roomBounds(room)
  const span =
    room.roof.fall === 'north' || room.roof.fall === 'south' ? b.maxZ - b.minZ : b.maxX - b.minX
  const pitch = (room.roof.pitch * Math.PI) / 180
  return top + Math.tan(pitch) * (room.roof.kind === 'gable' ? span / 2 : span)
}

const overlapsInPlan = (a: RoomSpec, b: RoomSpec): boolean => {
  const p = roomBounds(a)
  const q = roomBounds(b)
  return p.minX < q.maxX - EPS && p.maxX > q.minX + EPS && p.minZ < q.maxZ - EPS && p.maxZ > q.minZ + EPS
}

/**
 * How far a suppressed eave stops *short* of the wall it leans on.
 *
 * Not flush: flush puts the slab's cut end exactly in the plane of the
 * neighbour's wall face, and two surfaces in one plane shimmer against each
 * other as you move — the porch roof's end fighting the great room's south
 * wall, seen from inside the room. A couple of centimetres buries the cut end
 * inside the wall slab, which is 12 cm thick, so nothing shows from either side.
 */
const JOINT = 0.02

/**
 * How far the eaves stand out on one side — which is the nominal overhang,
 * unless there is a building in the way.
 *
 * A roof does not overhang into the wall it leans on. Without this the porch's
 * shed roof reached 45 cm *through* the cabin's south wall and came out at head
 * height over the great room, and the kitchen's gable end did the same through
 * the east wall. Both are the same mistake: growing a footprint uniformly when
 * one of its sides is a joint rather than an edge.
 *
 * "In the way" is a neighbour whose *roof* reaches at least as high as these
 * eaves and whose wall runs along this side. The roof, not the walls: the
 * bathroom's walls stop below the kitchen's eaves, but its slope rises well
 * above them, and the kitchen's eave slab was buried in its shingles. Equal
 * heights count, so two wings of the same height meet in a valley instead of
 * crossing overhangs in the gap between them.
 */
function overhangOn(
  room: RoomSpec,
  rooms: readonly RoomSpec[],
  wall: Wall,
  nominal: number,
  eaves: number,
): number {
  const b = roomBounds(room)
  const near = (a: number, c: number) => Math.abs(a - c) <= ROOM_GAP + 0.02

  for (const other of rooms) {
    if (other === room || roofTopOf(other) < eaves - EPS) continue
    const o = roomBounds(other)
    // Adjacent, not merely somewhere else in the building: the two footprints
    // have to line up across the side in question.
    const alongX = o.minX < b.maxX + ROOM_GAP + EPS && o.maxX > b.minX - ROOM_GAP - EPS
    const alongZ = o.minZ < b.maxZ + ROOM_GAP + EPS && o.maxZ > b.minZ - ROOM_GAP - EPS
    if (!alongX || !alongZ) continue

    if (wall === 'east' && near(o.minX, b.maxX)) return -JOINT
    if (wall === 'west' && near(o.maxX, b.minX)) return -JOINT
    if (wall === 'south' && near(o.minZ, b.maxZ)) return -JOINT
    if (wall === 'north' && near(o.maxZ, b.minZ)) return -JOINT
  }
  return nominal
}

/**
 * Which rooms get a roof, and where its two heights are.
 *
 * A room is skipped when something else stands over the same ground and reaches
 * at least as high: the bedroom roofs the reading corner under it, and the great
 * room roofs the loft *inside* it. The loft is the case that makes the rule
 * subtle — it shares the great room's ceiling exactly, so equal tops are broken
 * by footprint, and the bigger room is the one the building is shaped by.
 */
export function roofsOf(rooms: readonly RoomSpec[]): DerivedRoof[] {
  const roofs: DerivedRoof[] = []

  for (const room of rooms) {
    if (room.roof.kind === 'none') continue

    const covered = rooms.some(
      (other) =>
        other !== room &&
        overlapsInPlan(room, other) &&
        (topOf(other) > topOf(room) + EPS ||
          (Math.abs(topOf(other) - topOf(room)) <= EPS && areaOf(other) > areaOf(room))),
    )
    if (covered) continue

    const walls = roomBounds(room)
    const over = room.roof.overhang
    const eavesAt = topOf(room)
    const out = (wall: Wall) => overhangOn(room, rooms, wall, over, eavesAt)
    const covers = {
      minX: walls.minX - out('west'),
      maxX: walls.maxX + out('east'),
      minZ: walls.minZ - out('north'),
      maxZ: walls.maxZ + out('south'),
    }

    const axis: 'x' | 'z' = room.roof.fall === 'north' || room.roof.fall === 'south' ? 'z' : 'x'
    const span = axis === 'z' ? covers.maxZ - covers.minZ : covers.maxX - covers.minX
    const pitch = (room.roof.pitch * Math.PI) / 180
    const eaves = eavesAt
    // A gable climbs half the span to its ridge; a shed climbs the whole of it
    // to the high wall. Flat is flat, and is the one honest way to say "lid".
    const rise =
      room.roof.kind === 'flat'
        ? 0
        : Math.tan(pitch) * (room.roof.kind === 'gable' ? span / 2 : span)

    roofs.push({
      roomId: room.id,
      kind: room.roof.kind,
      fall: room.roof.fall,
      axis,
      walls,
      covers,
      eaves,
      peak: eaves + rise,
      pitch: room.roof.kind === 'flat' ? 0 : pitch,
      overhang: over,
    })
  }

  return roofs
}

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
  if (WALL_MOUNTED.has(item.kind)) return room.elevation + (item.y ?? 1.55) - height / 2
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
  /**
   * The forest, grown from the rooms it has to keep out of.
   *
   * Derived rather than owned by the renderer because a tree is something you
   * walk into now: the trunks in `solids` and the trunks you can see have to be
   * the same trunks, and the only way to guarantee that is one list.
   */
  trees: Tree[]
  /** Every solid, with its vertical extent. Filter by level before colliding. */
  solids: Solid[]
  /** Flattened solids, ignoring level. Handy for tests and single-storey rooms. */
  colliders: Aabb[]
  /** Floor rectangles with the stairwells cut out, for standing on. */
  slabs: Slab[]
  /** One per roofed room. Above head height, so nothing collides with these. */
  roofs: DerivedRoof[]
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

/**
 * A moving box the app made, off the stack in the kitchen, rather than one the
 * document placed.
 *
 * Same shape as an override plus the room whose frame `at` is written in —
 * a spawned box has no document entry to inherit a room from. It lives in
 * `books.json` beside the shoved-furniture overrides, and for the same reason:
 * the app must not write furniture into `library.json`.
 */
export type SpawnedBox = FurnitureOverride & { room: string }

/**
 * The app's edits to the document's box population: boxes taken off the stack,
 * and document boxes broken down. Nothing but `box` furniture is ever in
 * either — the rest of the room is the document's alone.
 */
export type BoxEdits = {
  spawned?: Record<string, SpawnedBox>
  removed?: readonly string[]
}

export function deriveWorld(
  doc: WorldDocument,
  overrides: Record<string, FurnitureOverride> = {},
  boxEdits: BoxEdits = {},
): DerivedWorld {
  const shelves: DerivedShelf[] = []
  const furniture: DerivedFurniture[] = []
  const stairs: DerivedStair[] = []
  const lights: DerivedLight[] = []
  const solids: Solid[] = []
  const slabs: Slab[] = []

  // Boxes made off the stack join their room's furniture list; a spawned box
  // whose room has been edited away falls back to the first room rather than
  // vanishing with the books in it.
  const removed = new Set(boxEdits.removed ?? [])
  const extraBoxes = new Map<string, FurnitureSpec[]>()
  const extraElevation = new Map<string, number | undefined>()
  for (const [id, spawn] of Object.entries(boxEdits.spawned ?? {})) {
    const roomId = doc.rooms.some((room) => room.id === spawn.room)
      ? spawn.room
      : doc.rooms[0]?.id
    if (roomId === undefined) continue
    const list = extraBoxes.get(roomId)
    const spec: FurnitureSpec = { id, kind: 'box', at: spawn.at, facing: spawn.facing }
    if (list) list.push(spec)
    else extraBoxes.set(roomId, [spec])
    extraElevation.set(id, spawn.elevation)
  }

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

    const pieces = [
      // A broken-down box is gone from the room; everything else is untouchable.
      ...room.furniture.filter((item) => !(item.kind === 'box' && removed.has(item.id))),
      ...(extraBoxes.get(room.id) ?? []),
    ]
    for (const item of pieces) {
      const base = FURNITURE_SIZE[item.kind]
      const override = overrides[item.id]
      const at = override?.at ?? item.at
      const facing = override?.facing ?? item.facing

      const hung = WALL_MOUNTED.has(item.kind)
      const width = item.size?.[0] ?? base.width
      const depth = hung ? base.depth : (item.size?.[1] ?? base.depth)
      // A flight's height is its `rise` — the same number the ramp below climbs.
      // Reading `height` here instead left the treads at the kind's default 2.6
      // while the ramp went to wherever the document said, so the bedroom flight
      // was drawn ending 62 cm under the floor it delivers you onto.
      const height = hung
        ? (item.size?.[1] ?? base.height)
        : item.kind === 'stairs'
          ? (item.rise ?? base.height)
          : (item.height ?? base.height)
      const rotationY = radians(facing)
      // A spawned box carries the floor it was set down on the same way a
      // shoved one does; an unshoved document piece stands on its room's own.
      const baseY =
        override?.elevation ?? extraElevation.get(item.id) ?? mountHeight(room, item, height)

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
          // from its shade, a pendant from just under its own body, and a string
          // of fairy lights from the line it hangs on.
          y:
            baseY +
            (item.kind === 'floorlamp'
              ? 1.44
              : item.kind === 'fireplace'
                ? 0.4
                : item.kind === 'campfire'
                  ? 0.3
                  : item.kind === 'fairylights'
                    ? -0.06
                    : 0.12),
          z: derived.z,
          defaultOn: item.on ?? true,
        })
      }

      if (item.kind === 'stairs') {
        const run = item.size?.[1] ?? base.depth
        // One number for the climb, shared with what gets drawn: the ramp and
        // the treads disagreeing is invisible until you are standing on it.
        const rise = height
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

  // The forest keeps out of every room's footprint plus a margin to walk in,
  // which is what leaves you a way round the outside of the building.
  const trees = growForest(
    doc.rooms.map((room) => {
      const b = roomBounds(room)
      return {
        minX: b.minX - CLEARING,
        maxX: b.maxX + CLEARING,
        minZ: b.minZ - CLEARING,
        maxZ: b.maxZ + CLEARING,
      }
    }),
  )
  solids.push(...treeSolids(trees))

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
    trees,
    solids,
    colliders: solids,
    slabs,
    roofs: roofsOf(doc.rooms),
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

  // The ground, which is a floor like any other now that you can walk out of
  // the porch. It comes last and loses every tie because it is the lowest thing
  // there is: standing in a room, the boards under you win, and the only points
  // where the ground is the answer are the ones with no building over them.
  //
  // `terrainAt` returns null in the lake and past the edge of the world, which
  // is the same answer a stairwell gives — nothing here — and refuses the step
  // for the same reason.
  const ground = terrainAt(x, z)
  if (ground !== null && ground <= from + STEP_UP && (best === null || ground > best)) {
    best = ground
  }

  return best
}

/** How big a step up you can take without stairs: a threshold, not a wall. */
export const STEP_UP = 0.42

/**
 * Where a food delivery is left: at the foot of the porch steps, on the ground
 * the treads walk down to. A map with no `step` gets it at the spawn instead —
 * wherever that is, it is somewhere the person who wrote the map stands.
 */
export function deliverySpot(world: DerivedWorld): { x: number; y: number; z: number; yaw: number } {
  const step = world.furniture.find((item) => item.kind === 'step')
  if (step) {
    const x = step.x + Math.sin(step.rotationY) * (step.depth / 2 + 0.45)
    const z = step.z + Math.cos(step.rotationY) * (step.depth / 2 + 0.45)
    return { x, y: floorAt(world, x, z, step.y) ?? step.y, z, yaw: step.rotationY + Math.PI }
  }
  const { x, z, y } = world.spawn
  return { x: x + 0.6, y: floorAt(world, x + 0.6, z, y) ?? y, z, yaw: 0 }
}

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
