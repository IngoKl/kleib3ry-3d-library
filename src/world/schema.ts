/**
 * The world document: `library.json` in the library folder.
 *
 * Hand-edited, so every parse failure names the offending path and what was
 * expected. A bad document is rejected whole and the running room is left alone;
 * half-applying an edit is a good way to lose a library. Nothing the app writes
 * lands here — shelving, boxes and lamps live beside it.
 */

/** Which wall of a room an opening sits in. +Z is south, -Z is north. */
export type Wall = 'north' | 'south' | 'east' | 'west'

export type Opening = {
  wall: Wall
  /** Centre of the opening along that wall, in metres from the wall's middle. */
  at: number
  width: number
  height: number
  /** Height of the bottom edge above the floor. A door sits at 0. */
  sill: number
  kind: 'door' | 'window'
  /** An unglazed opening with a waist-high sill is a balustrade or a railing. */
  glazed: boolean
}

export type ShelfSpec = {
  /** What the book layout is keyed by: rename it and its books go into boxes. */
  id: string
  /** Position in room-local metres, measured from the room's centre. */
  at: [number, number]
  /** Degrees clockwise about Y. 0 faces +Z (south); the front is the open side. */
  facing: number
  rows: number
  /**
   * A starting label, on a card on the case's top edge. An in-app label
   * overrides it from `books.json`, so the two never contend for one file.
   */
  label?: string
}

/** Each kind is a few boxes and cylinders in `Furniture.tsx`; no model files. */
export type FurnitureKind =
  // seating and surfaces
  | 'armchair'
  | 'sofa'
  | 'diningchair'
  | 'bench'
  | 'footstool'
  | 'sidetable'
  | 'table'
  | 'desk'
  | 'bed'
  // things you carry about and set down where you want them
  | 'foldingchair'
  | 'foldingtable'
  // storage
  | 'box'
  | 'boxstack'
  | 'recordshelf'
  | 'tapecrate'
  | 'kitchencounter'
  // plumbing
  | 'bathtub'
  | 'toilet'
  | 'basin'
  // things that do something
  | 'recordplayer'
  | 'crt'
  | 'coffeemaker'
  | 'fireplace'
  | 'computer'
  | 'postits'
  | 'marker'
  | 'phone'
  | 'fridge'
  | 'bin'
  | 'headlamp'
  | 'door'
  // camping
  | 'tent'
  | 'campfire'
  | 'arcade'
  | 'rombox'
  // light
  | 'floorlamp'
  | 'pendant'
  | 'fairylights'
  | 'lightswitch'
  // dressing
  | 'rug'
  | 'plant'
  | 'picture'
  | 'whiteboard'
  | 'clock'
  // structure
  | 'stairs'
  | 'step'
  // site machinery, injected by `deriveWorld` and deliberately absent from
  // FURNITURE_KINDS: the cable line is a fact about the valley, so a document
  // cannot place a station any more than it can move the lake
  | 'cablecar'

export type FurnitureSpec = {
  id: string
  kind: FurnitureKind
  at: [number, number]
  facing: number
  /** Footprint in metres, or width by height for anything hung on a wall. */
  size?: [number, number]
  /** Height override, for the kinds where it is worth varying (tables, counters). */
  height?: number
  /** Centre height above the floor, for the kinds that hang on a wall. */
  y?: number
  /** Which file in `artwork/` to show. Omitted, pictures are dealt out in order. */
  source?: string
  /** How far a flight of stairs climbs. Its `size` is [width, run]. */
  rise?: number
  /** Whether a lamp starts lit; switching one is remembered in `ambience.json`. */
  on?: boolean
}

/**
 * The roof over a room. Only the topmost room over a patch of ground is roofed
 * (see `roofsOf`), so a loft does not sprout one indoors. `fall` names the sides
 * a gable's eaves run along, or a shed's low side — and a porch roof must fall
 * away from the building it leans on, or it drains into it.
 */
export type RoofKind = 'none' | 'gable' | 'shed' | 'flat'

export type RoofSpec = {
  kind: RoofKind
  /** Degrees from horizontal. 0 is flat, 45 is steep, 30 is a house. */
  pitch: number
  /** How far the eaves stand out past the walls, in metres. */
  overhang: number
  fall: Wall
}

/** A rectangle cut out of a room's floor, for a stairwell. */
export type FloorHole = {
  at: [number, number]
  size: [number, number]
}

export type FloorFinish = 'boards' | 'deck' | 'stone'

export type RoomSpec = {
  id: string
  name: string
  /** Room centre in world metres. Rooms are axis-aligned. */
  origin: [number, number]
  /** Width along X, depth along Z. */
  size: [number, number]
  height: number
  /**
   * Floor height above the ground plane. A loft is a room standing over another
   * room's plan, which is why rooms may overlap on different levels.
   */
  elevation: number
  /** Which walls are built. A porch has none; a loft has three and a balustrade. */
  walls: Wall[]
  /** False for a room whose ceiling is the floor of the room above it. */
  ceiling: boolean
  /** Rectangles missing from the floor, so a stair can come up through it. */
  holes: FloorHole[]
  floor: FloorFinish
  roof: RoofSpec
  /** True for a porch: no interior lighting, and it is not "inside". */
  outdoor: boolean
  openings: Opening[]
  shelves: ShelfSpec[]
  furniture: FurnitureSpec[]
}

export type WorldDocument = {
  name: string
  /** Where you stand when the library opens: room id and room-local metres. */
  spawn: { room: string; at: [number, number]; facing: number }
  rooms: RoomSpec[]
}

// ---- parsing -----------------------------------------------------------

export class WorldError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'WorldError'
  }
}

type Json = Record<string, unknown>

const fail = (path: string, message: string): never => {
  throw new WorldError(path, message)
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function object(value: unknown, path: string): Json {
  if (!isObject(value)) fail(path, `expected an object, found ${describe(value)}`)
  return value as Json
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  return typeof value
}

function str(source: Json, key: string, path: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, `expected a non-empty string, found ${describe(value)}`)
  }
  return value as string
}

/** An optional string, for the fields that simply may not be there. */
function optionalStr(source: Json, key: string, path: string): string | undefined {
  const value = source[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path}.${key}`, `expected a non-empty string, found ${describe(value)}`)
  }
  return value as string
}

/** Part of a `shelfId:row` layout key, so a colon in one would misplace books. */
function identifier(source: Json, key: string, path: string): string {
  const value = str(source, key, path)
  if (value.includes(':')) {
    fail(`${path}.${key}`, `ids may not contain a colon — found ${JSON.stringify(value)}`)
  }
  return value
}

function num(source: Json, key: string, path: string, fallback?: number): number {
  const value = source[key]
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path}.${key}`, `expected a number, found ${describe(value)}`)
  }
  return value as number
}

function optionalNum(source: Json, key: string, path: string): number | undefined {
  return source[key] === undefined ? undefined : num(source, key, path)
}

function bool(source: Json, key: string, path: string, fallback: boolean): boolean {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    fail(`${path}.${key}`, `expected true or false, found ${describe(value)}`)
  }
  return value as boolean
}

function optionalBool(source: Json, key: string, path: string): boolean | undefined {
  return source[key] === undefined ? undefined : bool(source, key, path, false)
}

function positive(source: Json, key: string, path: string, fallback?: number): number {
  const value = num(source, key, path, fallback)
  if (value <= 0) fail(`${path}.${key}`, `expected a positive number, found ${value}`)
  return value
}

function pair(source: Json, key: string, path: string): [number, number] {
  const value = source[key]
  if (!Array.isArray(value) || value.length !== 2) {
    fail(`${path}.${key}`, `expected two numbers like [x, z], found ${describe(value)}`)
  }
  const [a, b] = value as unknown[]
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
    fail(`${path}.${key}`, `expected two numbers like [x, z], found [${a}, ${b}]`)
  }
  return [a as number, b as number]
}

function list(source: Json, key: string, path: string): unknown[] {
  const value = source[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`${path}.${key}`, `expected a list, found ${describe(value)}`)
  return value as unknown[]
}

function oneOf<T extends string>(
  source: Json,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const value = source[key]
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${path}.${key}`, `expected one of ${allowed.join(', ')} — found ${JSON.stringify(value)}`)
  }
  return value as T
}

const WALLS = ['north', 'south', 'east', 'west'] as const
const FLOORS = ['boards', 'deck', 'stone'] as const
const ROOFS = ['none', 'gable', 'shed', 'flat'] as const

/**
 * Ids the site's own furniture answers to — the cable car stations and the
 * lookout deck's pieces, injected by `deriveWorld`. Refused in a document, or
 * a map could put a second piece under an id E already boards a cabin by.
 */
export const SITE_IDS = [
  'cablecar-base',
  'cablecar-top',
  'lookout-chair-a',
  'lookout-chair-b',
  'lookout-table',
  'lookout-rug',
  'lookout-bench',
  'lookout-lights',
  'lookout-stand',
  'lookout-player',
] as const

export const FURNITURE_KINDS = [
  'armchair',
  'sofa',
  'diningchair',
  'bench',
  'footstool',
  'sidetable',
  'table',
  'desk',
  'bed',
  'foldingchair',
  'foldingtable',
  'box',
  'boxstack',
  'recordshelf',
  'tapecrate',
  'kitchencounter',
  'bathtub',
  'toilet',
  'basin',
  'recordplayer',
  'crt',
  'coffeemaker',
  'fireplace',
  'computer',
  'postits',
  'marker',
  'phone',
  'fridge',
  'bin',
  'headlamp',
  'door',
  'tent',
  'campfire',
  'arcade',
  'rombox',
  'floorlamp',
  'pendant',
  'fairylights',
  'lightswitch',
  'rug',
  'plant',
  'picture',
  'whiteboard',
  'clock',
  'stairs',
  'step',
] as const

function parseOpening(raw: unknown, path: string): Opening {
  const source = object(raw, path)
  const kind = oneOf(source, 'kind', path, ['door', 'window'] as const, 'window')
  return {
    wall: oneOf(source, 'wall', path, WALLS),
    at: num(source, 'at', path, 0),
    width: positive(source, 'width', path, kind === 'door' ? 0.9 : 1.4),
    height: positive(source, 'height', path, kind === 'door' ? 2.05 : 1.5),
    sill: num(source, 'sill', path, kind === 'door' ? 0 : 0.9),
    kind,
    glazed: bool(source, 'glazed', path, kind === 'window'),
  }
}

function parseShelf(raw: unknown, path: string): ShelfSpec {
  const source = object(raw, path)
  const rows = positive(source, 'rows', path, 5)
  if (!Number.isInteger(rows)) fail(`${path}.rows`, `expected a whole number, found ${rows}`)
  const shelf: ShelfSpec = {
    id: identifier(source, 'id', path),
    at: pair(source, 'at', path),
    facing: num(source, 'facing', path, 0),
    rows,
  }
  const label = optionalStr(source, 'label', path)
  if (label !== undefined) shelf.label = label
  return shelf
}

function parseFurniture(raw: unknown, path: string): FurnitureSpec {
  const source = object(raw, path)
  const spec: FurnitureSpec = {
    id: identifier(source, 'id', path),
    kind: oneOf(source, 'kind', path, FURNITURE_KINDS),
    at: pair(source, 'at', path),
    facing: num(source, 'facing', path, 0),
  }
  if (source.size !== undefined) spec.size = pair(source, 'size', path)

  const height = optionalNum(source, 'height', path)
  if (height !== undefined) spec.height = height
  const y = optionalNum(source, 'y', path)
  if (y !== undefined) spec.y = y
  const rise = optionalNum(source, 'rise', path)
  if (rise !== undefined) spec.rise = rise
  const source_ = optionalStr(source, 'source', path)
  if (source_ !== undefined) spec.source = source_
  const on = optionalBool(source, 'on', path)
  if (on !== undefined) spec.on = on

  return spec
}

/**
 * Defaults chosen so no document has to mention the roof: a gable for a room, a
 * shed for a porch, eaves on the longer walls so the ridge runs lengthwise.
 */
function parseRoof(source: Json, path: string, room: { size: [number, number]; outdoor: boolean }): RoofSpec {
  const wider = room.size[0] >= room.size[1]
  const fallback: RoofSpec = {
    kind: room.outdoor ? 'shed' : 'gable',
    pitch: room.outdoor ? 18 : 30,
    overhang: 0.45,
    fall: wider ? 'south' : 'east',
  }
  const raw = source.roof
  if (raw === undefined) return fallback

  const roof = object(raw, `${path}.roof`)
  const pitch = num(roof, 'pitch', `${path}.roof`, fallback.pitch)
  if (pitch < 0 || pitch >= 80) {
    fail(`${path}.roof.pitch`, `expected degrees between 0 and 80, found ${pitch}`)
  }
  const overhang = num(roof, 'overhang', `${path}.roof`, fallback.overhang)
  if (overhang < 0) fail(`${path}.roof.overhang`, `expected 0 or more, found ${overhang}`)

  return {
    kind: oneOf(roof, 'kind', `${path}.roof`, ROOFS, fallback.kind),
    pitch,
    overhang,
    fall: oneOf(roof, 'fall', `${path}.roof`, WALLS, fallback.fall),
  }
}

function parseHole(raw: unknown, path: string): FloorHole {
  const source = object(raw, path)
  const size = pair(source, 'size', path)
  if (size[0] <= 0 || size[1] <= 0) {
    fail(`${path}.size`, `expected a positive width and depth, found [${size[0]}, ${size[1]}]`)
  }
  return { at: pair(source, 'at', path), size }
}

/** Omitted means all four; an explicit empty list is a porch, and is allowed. */
function parseWalls(source: Json, path: string): Wall[] {
  const value = source.walls
  if (value === undefined) return [...WALLS]
  if (!Array.isArray(value)) fail(`${path}.walls`, `expected a list, found ${describe(value)}`)
  return (value as unknown[]).map((item, i) => {
    if (typeof item !== 'string' || !WALLS.includes(item as Wall)) {
      fail(`${path}.walls[${i}]`, `expected one of ${WALLS.join(', ')} — found ${JSON.stringify(item)}`)
    }
    return item as Wall
  })
}

function parseRoom(raw: unknown, path: string): RoomSpec {
  const source = object(raw, path)
  const id = identifier(source, 'id', path)
  const size = pair(source, 'size', path)
  if (size[0] <= 0 || size[1] <= 0) {
    fail(`${path}.size`, `expected positive width and depth, found [${size[0]}, ${size[1]}]`)
  }
  const outdoor = bool(source, 'outdoor', path, false)

  return {
    id,
    name: typeof source.name === 'string' ? source.name : id,
    origin: pair(source, 'origin', path),
    size,
    height: positive(source, 'height', path, 3.2),
    elevation: num(source, 'elevation', path, 0),
    walls: parseWalls(source, path),
    ceiling: bool(source, 'ceiling', path, true),
    holes: list(source, 'holes', path).map((item, i) => parseHole(item, `${path}.holes[${i}]`)),
    floor: oneOf(source, 'floor', path, FLOORS, outdoor ? 'deck' : 'boards'),
    roof: parseRoof(source, path, { size, outdoor }),
    outdoor,
    openings: list(source, 'openings', path).map((item, i) =>
      parseOpening(item, `${path}.openings[${i}]`),
    ),
    shelves: list(source, 'shelves', path).map((item, i) =>
      parseShelf(item, `${path}.shelves[${i}]`),
    ),
    furniture: list(source, 'furniture', path).map((item, i) =>
      parseFurniture(item, `${path}.furniture[${i}]`),
    ),
  }
}

function parseSpawn(raw: unknown, path: string): WorldDocument['spawn'] {
  const source = object(raw, path)
  return {
    room: str(source, 'room', path),
    at: pair(source, 'at', path),
    facing: num(source, 'facing', path, 0),
  }
}

/**
 * Parse and check a world document, throwing `WorldError` with the offending
 * path. Callers surface it verbatim: "rooms[1].shelves[3].at: expected two
 * numbers like [x, z]" is fixable, and "invalid" is not.
 */
export function parseWorld(raw: unknown): WorldDocument {
  const source = object(raw, '')

  const rooms = list(source, 'rooms', '').map((item, i) => parseRoom(item, `rooms[${i}]`))
  if (rooms.length === 0) fail('rooms', 'a library needs at least one room')

  // Ids are what the book layout is keyed by, so a duplicate silently merges two
  // shelves' contents. Catch it here rather than letting books vanish.
  const seenRooms = new Set<string>()
  const seenShelves = new Set<string>()
  const seenFurniture = new Set<string>()
  for (const room of rooms) {
    if (seenRooms.has(room.id)) fail('rooms', `two rooms share the id "${room.id}"`)
    seenRooms.add(room.id)
    for (const shelf of room.shelves) {
      if (seenShelves.has(shelf.id)) {
        fail(`rooms[${room.id}].shelves`, `the shelf id "${shelf.id}" is used more than once`)
      }
      seenShelves.add(shelf.id)
    }
    for (const item of room.furniture) {
      if (seenFurniture.has(item.id)) {
        fail(`rooms[${room.id}].furniture`, `the id "${item.id}" is used more than once`)
      }
      if ((SITE_IDS as readonly string[]).includes(item.id)) {
        fail(`rooms[${room.id}].furniture`, `the id "${item.id}" is reserved for the site's cable car`)
      }
      seenFurniture.add(item.id)
    }
  }

  const spawn = source.spawn === undefined
    ? { room: rooms[0]!.id, at: [0, 0] as [number, number], facing: 0 }
    : parseSpawn(source.spawn, 'spawn')
  if (!seenRooms.has(spawn.room)) {
    fail('spawn.room', `there is no room called "${spawn.room}"`)
  }

  return {
    name: typeof source.name === 'string' ? source.name : 'Library',
    spawn,
    rooms,
  }
}

/**
 * Strip comments, so the hand-edited file can explain itself. Replaced by spaces
 * rather than removed, so `JSON.parse`'s "position 412" still points at the typo.
 */
export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!

    if (ch === '"') {
      // Copy the string verbatim; a // inside one is data, not a comment.
      out += ch
      i += 1
      while (i < text.length) {
        const c = text[i]!
        out += c
        i += 1
        if (c === '\\') {
          if (i < text.length) {
            out += text[i]
            i += 1
          }
        } else if (c === '"') break
      }
      continue
    }

    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }

    if (ch === '/' && text[i + 1] === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' '
        i += 1
      }
      out += '  '
      i += 2
      continue
    }

    out += ch
    i += 1
  }
  return out
}

/** Parse from text, so a syntax error reports as a world error like any other. */
export function parseWorldText(text: string): WorldDocument {
  let raw: unknown
  try {
    raw = JSON.parse(stripJsonComments(text))
  } catch (e) {
    throw new WorldError('', `not valid JSON — ${e instanceof Error ? e.message : String(e)}`)
  }
  return parseWorld(raw)
}
