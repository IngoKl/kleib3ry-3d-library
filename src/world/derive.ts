import { aabbFromCentre, type Aabb } from '../scene/collision'
import { CLEARING, growForest, treeSolids, type Tree } from './forest'
import { CABLE_CAR, CABLE_SIDE, GROUND_Y, PLATFORM, terrainAt } from './terrain'
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
 * The world document turned into what the scene and the walk controller need:
 * wall panels with their openings cut out, floor slabs minus the stairwell,
 * shelf transforms, colliders, and the floor height under any point.
 *
 * Nothing here is stored, so an edit is a full recompute rather than a patch —
 * which is what makes live reload safe: no incremental path can drift.
 */

/** Metres. Walls are drawn *outward* from the room's floor bounds. */
export const WALL = 0.12
export const SKIRTING = { height: 0.11, depth: 0.02 }
/** How thick a floor slab is. It is also the ceiling of whatever is beneath it. */
export const FLOOR_SLAB = 0.22

/** Rooms placed this far apart have flush wall slabs, so two doors make one doorway. */
export const ROOM_GAP = 2 * WALL

/**
 * Footprint, height and solidity per kind. `surface` is where a book can be put
 * down, as a fraction of the piece's height, or 0 for anything that takes none.
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
  // The two you can carry off, both narrower than the porch door they live
  // beside. Ordinary furniture in every other respect, which is the point.
  foldingchair: { width: 0.46, depth: 0.5, height: 0.88, solid: true, surface: false },
  foldingtable: { width: 0.86, depth: 0.58, height: 0.7, solid: true, surface: true },
  box: { width: 0.52, depth: 0.4, height: 0.36, solid: true, surface: false },
  // Flattened boxes waiting to be made up. E takes one (see `spawnBox`), which
  // is how a room gets more boxes than the document put in it.
  boxstack: { width: 0.6, depth: 0.3, height: 0.62, solid: true, surface: false },
  recordshelf: { width: 0.9, depth: 0.36, height: 0.78, solid: true, surface: true },
  // Lower than a tape is tall (23 cm), or the crate shows nothing but its own
  // sides; 22 leaves the labels standing proud.
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
  // Not solid: it stands on a desk, and a collider up there is one you walk
  // into while standing beside the desk.
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
  // Not solid here: whether it blocks depends on whether it is shut, which is
  // ambience state, so the walk controller adds that collider itself.
  door: { width: 1.0, depth: 0.1, height: 2.02, solid: false, surface: false },
  // An A-frame shelter. Solid: canvas is not something to walk through.
  tent: { width: 1.9, depth: 2.2, height: 1.5, solid: true, surface: false },
  campfire: { width: 0.95, depth: 0.95, height: 0.4, solid: true, surface: false },
  // An upright cabinet: person-height, deep enough to house a tube, and solid
  // because it stands on the floor and you walk up to its front.
  arcade: { width: 0.72, depth: 0.78, height: 1.75, solid: true, surface: false },
  // Not a surface: it is open-topped, and a piece in both the fixtures and the
  // surfaces group would be drawn twice.
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
  // Not solid: the point is to walk down it, and the controller reads the
  // floor rather than the joinery — a 24 cm drop is inside `STEP_UP`.
  step: { width: 1.4, depth: 0.62, height: 0.24, solid: false, surface: false },
  // A cable car station: posts, a wheel and a call board, standing beside the
  // boarding spot. Site furniture — see `siteFurniture` below.
  cablecar: { width: 1.15, depth: 0.7, height: 2.5, solid: true, surface: false },
}

/**
 * Wall-hung furniture: `size` is width by height, `y` is the centre rather than
 * the base, and depth comes from the kind rather than the document.
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
 * Furniture `X` carries off — not a moving box, which has its own verbs. Stored
 * as a `FurnitureOverride`: the document says where a piece lives, the override
 * where you left it.
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
  'cablecar',
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
 * A collider with a vertical extent. Sliding still runs on the 2D `Aabb`, but
 * with a loft over the living room "is there a wall here" depends on which
 * floor you stand on, so the controller flattens the ones at its own height.
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
 * One wall as the boxes left once its openings are cut out: piers between them,
 * plus the apron below a window and the lintel above anything short of the ceiling.
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

/** Where a room's openings are, and whether anything is in them — chiefly for the rain. */
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
 * Wall colliders: the whole length minus the doors. Only openings you could
 * walk through are subtracted, which is also what makes a balustrade work.
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
 * It runs out to the outside of each wall the room builds, because a wall
 * stands on the floor rather than beside it — without that there is a 24 cm
 * strip of nothing in every doorway, which the controller refuses to step into.
 * Only under walls it builds, though, or a flush-butted porch lays a second
 * slab at the cabin's height and the two fight for every pixel.
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
 * A roof, resolved to the two heights and one footprint the renderer needs. The
 * plane passes through the eaves at the top of the walls and only rises, so it
 * cannot cut through the ceiling below; the overhang is the one part that dips
 * under that line, outside the walls where there is nothing to intersect.
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

/** The highest a room's roof reaches — what the overhang rule has to clear. */
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
 * How far a suppressed eave stops short of the wall it leans on. Flush would put
 * its cut end in the plane of the neighbour's wall face, and coplanar surfaces
 * shimmer; a couple of centimetres buries it in the 12 cm slab instead.
 */
const JOINT = 0.02

/**
 * How far the eaves stand out on one side: the nominal overhang, unless a
 * building is in the way. Growing a footprint uniformly when one side is a joint
 * rather than an edge puts a roof through its neighbour's wall.
 *
 * "In the way" tests the neighbour's roof, not its walls — a low wall can carry
 * a slope well above these eaves. Equal heights count, so two wings of the same
 * height meet in a valley rather than crossing overhangs in the gap.
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
 * Which rooms get a roof, and where its two heights are. A room is skipped when
 * something over the same ground reaches at least as high. A loft shares its
 * room's ceiling exactly, so equal tops are broken by footprint — the bigger
 * room is the one the building is shaped by.
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
  /** World height of the piece's base — see `mountHeight` for the three cases. */
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
 * Where a piece's base sits, in world metres. `y` normally means "off this
 * room's floor"; two kinds do not stand on the floor at all, so a picture's `y`
 * is the centre of its frame and a pendant hangs from the ceiling.
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
   * The forest, grown from the rooms it has to keep out of. Derived rather than
   * owned by the renderer because the trunks in `solids` and the trunks you can
   * see have to be the same trunks.
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
 * Where a piece has been shoved to, overriding the document. Kept out of
 * `library.json` on purpose: that file is the user's, and writing furniture back
 * into it would put their comments and formatting at the mercy of a shove.
 *
 * `elevation` is the floor it was set down on, optional because older saves lack
 * it — without it a box carried up a flight stands at its document room's storey.
 */
export type FurnitureOverride = { at: [number, number]; facing: number; elevation?: number }

/**
 * A box the app made off the kitchen stack rather than one the document placed.
 * An override plus the room whose frame `at` is written in, since a spawned box
 * has no document entry to inherit one from.
 */
export type SpawnedBox = FurnitureOverride & { room: string }

/**
 * The app's edits to the document's boxes: made off the stack, or broken down.
 * Nothing but `box` furniture is ever in either.
 */
export type BoxEdits = {
  spawned?: Record<string, SpawnedBox>
  removed?: readonly string[]
}

/**
 * The furniture the site itself provides, in world coordinates and with the
 * `site` room id, since no document room owns the mountainside. Ordinary
 * furniture in every other respect: the stations are appliances E operates,
 * the chairs and bench are seats, the fairy lights are a lamp on the pool —
 * which is what makes the lookout a place to read rather than scenery.
 */
function siteFurniture(): DerivedFurniture[] {
  const piece = (
    id: string,
    kind: FurnitureKind,
    x: number,
    y: number,
    z: number,
    facing: number,
    extra: Partial<Pick<FurnitureSpec, 'size' | 'on'>> = {},
  ): DerivedFurniture => {
    const base = FURNITURE_SIZE[kind]
    return {
      id,
      kind,
      at: [x, z],
      facing,
      ...extra,
      roomId: 'site',
      x,
      y,
      z,
      rotationY: radians(facing),
      width: extra.size?.[0] ?? base.width,
      depth: base.depth,
      height: base.height,
      surface: base.surface,
    }
  }

  const deckX = PLATFORM.x
  const deckZ = PLATFORM.z
  return [
    // The stations stand beside their boarding spots, wheels facing them.
    piece('cablecar-base', 'cablecar', CABLE_CAR.base.x + 1.4, GROUND_Y, CABLE_CAR.base.z - 0.2, 270),
    piece('cablecar-top', 'cablecar', deckX + 2.4, PLATFORM.y, deckZ + 1.9, 270),
    // Two armchairs at the south rail, angled a little towards each other, a
    // table between them and a rug underneath: the reading corner, moved up
    // the mountain. All facing the water, which is what the deck is for.
    piece('lookout-chair-a', 'armchair', deckX - 1.9, PLATFORM.y, deckZ + 1.4, 8),
    piece('lookout-chair-b', 'armchair', deckX - 0.55, PLATFORM.y, deckZ + 1.5, 352),
    piece('lookout-table', 'sidetable', deckX - 1.2, PLATFORM.y, deckZ + 0.45, 0),
    piece('lookout-rug', 'rug', deckX - 1.2, PLATFORM.y, deckZ + 1.2, 90),
    // The bench along the west rail, for company — or for the books.
    piece('lookout-bench', 'bench', deckX - 2.9, PLATFORM.y, deckZ - 0.4, 90),
    // A deck in the north-west corner, on its own stand: records ride up the
    // way books do, in hand — the cable car is offered with a sleeve held.
    piece('lookout-stand', 'sidetable', deckX - 2.9, PLATFORM.y, deckZ - 1.9, 0),
    piece('lookout-player', 'recordplayer', deckX - 2.9, PLATFORM.y + 0.56, deckZ - 1.9, 135),
    // Swooping between the two light-posts on the north rail's corners —
    // `Mountains.tsx` raises the posts to exactly this height, so the string's
    // ends are tied to something rather than to the sky. Lit by default: dusk
    // on the deck is the whole point of staying up here past it.
    piece('lookout-lights', 'fairylights', deckX, PLATFORM.y + 1.74, deckZ - PLATFORM.halfZ + 0.06, 0, {
      size: [(PLATFORM.halfX - 0.06) * 2, 0.22],
      on: true,
    }),
  ]
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

  // A spawned box whose room has been edited away falls back to the first room
  // rather than vanishing with the books in it.
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
      // A flight's height is its `rise`, the same number the ramp below climbs.
      // Reading `height` leaves the treads at the kind's default while the ramp
      // goes where the document says, ending the flight short of its floor.
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
          // Where the bulb is, not where the fitting starts: a floor lamp
          // lights from its shade, a pendant from under its own body.
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
            // Summed, not maxed: this is the AABB of a rotated rectangle, and
            // the schema accepts any facing. With max, a 45° flight loses its
            // corners and the walk refuses the step on real treads.
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

  // The site's own furniture: the cable car stations and the lookout's deck.
  // Injected here rather than written into the document, because the cable line
  // is a fact about the valley — a map can no more move a station than the lake
  // — and injecting *furniture* is what makes the crosshair, E, sitting and the
  // lamps work on the mountain without a second interaction path.
  for (const piece of siteFurniture()) {
    furniture.push(piece)
    if (FURNITURE_SIZE[piece.kind].solid) {
      solids.push(
        solidFrom(
          aabbFromCentre(piece.x, piece.z, piece.width, piece.depth, piece.rotationY),
          piece.y,
          piece.y + piece.height,
        ),
      )
    }
    if (LAMPS.has(piece.kind)) {
      lights.push({
        id: piece.id,
        kind: piece.kind,
        roomId: 'site',
        x: piece.x,
        // The string's bulbs hang just under where it is strung, as indoors.
        y: piece.y - 0.06,
        z: piece.z,
        defaultOn: piece.on ?? true,
      })
    }
  }

  // The cable tower stands on walkable ground at the range's toe, so its legs
  // are solid the way a trunk is; the cabins pass well over head height.
  const kink = CABLE_CAR.path[1]!
  for (const side of [-1, 1]) {
    solids.push(
      solidFrom(
        aabbFromCentre(kink.x + CABLE_SIDE.x * side, kink.z + CABLE_SIDE.z * side, 0.16, 0.16),
        GROUND_Y,
        kink.y + 2.6,
      ),
    )
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
 * Which room a world position is in. `near` disambiguates a loft from the room
 * under it — with two floors over one plan the question needs a height. Callers
 * that do not care pass nothing and get the lowest.
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
      // No height given: keep looking and answer with the lowest. Returning the
      // first match hands out the loft whenever a document lists it first.
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
 * The single answer to "what am I standing on", for the walk controller and for
 * anything you drop. `from` is the level you are at, because with a loft over a
 * room the right floor is the nearest one at or below you — and over a stairwell
 * there is none at loft level, which is how the controller refuses the step.
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

  // The ground is a floor like any other, but loses every tie: indoors the
  // boards win, so it only answers where no building stands. `terrainAt` gives
  // null in the lake and past the world's edge, as a stairwell does.
  const ground = terrainAt(x, z)
  if (ground !== null && ground <= from + STEP_UP && (best === null || ground > best)) {
    best = ground
  }

  return best
}

/** How big a step up you can take without stairs: a threshold, not a wall. */
export const STEP_UP = 0.42

/**
 * Where a food delivery is left: at the foot of the porch steps. A map with no
 * `step` gets the spawn instead, which is at least somewhere you stand.
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

/** What a dropped book lands on: the floor, or a table if it is over one. */
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
