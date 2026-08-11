import { aabbFromCentre, type Aabb } from '../scene/collision'
import type { FurnitureKind, FurnitureSpec, Opening, RoomSpec, Wall, WorldDocument } from './schema'

/**
 * Turning the world document into the things the scene and the walk controller
 * actually need: wall panels with holes cut in them, shelf transforms, and
 * colliders.
 *
 * All of it is derived — nothing here is stored — so an edit to `library.json`
 * is a full recompute rather than a patch. That is what makes live reload safe:
 * there is no incremental path that can drift from the file.
 */

/** Metres. Walls are drawn *outward* from the room's floor bounds. */
export const WALL = 0.12
export const SKIRTING = { height: 0.11, depth: 0.02 }

/**
 * Two rooms are joined by placing them `2 * WALL` apart, so their wall slabs sit
 * flush against each other and a door in both walls makes a short doorway.
 */
export const ROOM_GAP = 2 * WALL

/** Footprint and height for each furniture kind, and whether you bump into it. */
export const FURNITURE_SIZE: Record<
  FurnitureKind,
  { width: number; depth: number; height: number; solid: boolean }
> = {
  armchair: { width: 0.86, depth: 0.9, height: 0.98, solid: true },
  footstool: { width: 0.5, depth: 0.42, height: 0.38, solid: true },
  sidetable: { width: 0.44, depth: 0.44, height: 0.56, solid: true },
  rug: { width: 2.2, depth: 1.6, height: 0.012, solid: false },
  floorlamp: { width: 0.36, depth: 0.36, height: 1.66, solid: true },
  box: { width: 0.52, depth: 0.4, height: 0.36, solid: true },
}

/** Furniture you can sit in. A footstool is for feet. */
export const SITTABLE = new Set<FurnitureKind>(['armchair'])

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
  const y = (bottom + top) / 2
  const height = top - bottom
  const offset = wallOffset(room, wall)
  const [cx, cz] = room.origin

  return wallAxis(wall) === 'x'
    ? { position: [cx + along, y, offset], size: [length, height, WALL] }
    : { position: [offset, y, cz + along], size: [WALL, height, length] }
}

const openingsOn = (room: RoomSpec, wall: Wall): Opening[] =>
  room.openings.filter((o) => o.wall === wall).sort((a, b) => a.at - b.at)

/**
 * One wall, as the boxes left over once its openings are cut out: full-height
 * piers between openings, plus the apron below a window and the lintel above
 * anything that does not reach the ceiling.
 */
export function wallPanels(room: RoomSpec, wall: Wall): Panel[] {
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

/** The pane itself, so a window reads as light rather than as a hole. */
export function windowPanes(room: RoomSpec): Panel[] {
  const panes: Panel[] = []
  for (const wall of WALLS) {
    for (const opening of openingsOn(room, wall)) {
      if (opening.kind !== 'window') continue
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
 * Colliders for one wall: the whole length, minus the doors.
 *
 * A window's apron still blocks you — it is a waist-high wall — so only
 * openings you could actually walk through are subtracted.
 */
export function wallColliders(room: RoomSpec): Aabb[] {
  const boxes: Aabb[] = []

  for (const wall of WALLS) {
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
      boxes.push(aabbFromCentre(x, z, w, d))
    }
  }

  return boxes
}

// ---- shelves and furniture ---------------------------------------------

export type DerivedShelf = {
  id: string
  roomId: string
  /** World position of the unit's origin, at floor level. */
  x: number
  z: number
  rotationY: number
  rows: number
}

export type DerivedFurniture = FurnitureSpec & {
  roomId: string
  x: number
  z: number
  rotationY: number
  width: number
  depth: number
  height: number
}

const radians = (degrees: number) => (degrees * Math.PI) / 180

export type DerivedWorld = {
  doc: WorldDocument
  rooms: RoomSpec[]
  /** Document order, which is the order the renderer instances them in. */
  shelves: DerivedShelf[]
  shelfIndex: Map<string, number>
  furniture: DerivedFurniture[]
  colliders: Aabb[]
  spawn: { x: number; z: number; yaw: number }
}

export function deriveWorld(doc: WorldDocument): DerivedWorld {
  const shelves: DerivedShelf[] = []
  const furniture: DerivedFurniture[] = []
  const colliders: Aabb[] = []

  for (const room of doc.rooms) {
    const [ox, oz] = room.origin
    colliders.push(...wallColliders(room))

    for (const shelf of room.shelves) {
      const rotationY = radians(shelf.facing)
      shelves.push({
        id: shelf.id,
        roomId: room.id,
        x: ox + shelf.at[0],
        z: oz + shelf.at[1],
        rotationY,
        rows: shelf.rows,
      })
    }

    for (const item of room.furniture) {
      const base = FURNITURE_SIZE[item.kind]
      const width = item.size?.[0] ?? base.width
      const depth = item.size?.[1] ?? base.depth
      const rotationY = radians(item.facing)
      const derived: DerivedFurniture = {
        ...item,
        roomId: room.id,
        x: ox + item.at[0],
        z: oz + item.at[1],
        rotationY,
        width,
        depth,
        height: base.height,
      }
      furniture.push(derived)
      if (base.solid) {
        colliders.push(aabbFromCentre(derived.x, derived.z, width, depth, rotationY))
      }
    }
  }

  const spawnRoom = doc.rooms.find((room) => room.id === doc.spawn.room) ?? doc.rooms[0]!
  const spawn = {
    x: spawnRoom.origin[0] + doc.spawn.at[0],
    z: spawnRoom.origin[1] + doc.spawn.at[1],
    yaw: radians(doc.spawn.facing),
  }

  return {
    doc,
    rooms: doc.rooms,
    shelves,
    shelfIndex: new Map(shelves.map((shelf, i) => [shelf.id, i])),
    furniture,
    colliders,
    spawn,
  }
}

/** Which room a world position is in, if any. Used to light and cull by room. */
export function roomAt(world: DerivedWorld, x: number, z: number): RoomSpec | null {
  for (const room of world.rooms) {
    const b = roomBounds(room)
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return room
  }
  return null
}
