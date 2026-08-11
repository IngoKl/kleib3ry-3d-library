/**
 * The world document: `library.json` in your library folder.
 *
 * This is the file you edit by hand, so parsing is written for the person
 * making the mistake rather than for the machine — every failure names the path
 * that is wrong and what was expected there. A document that does not parse is
 * *rejected whole*: the room already on screen keeps running and the error goes
 * to the HUD. Half-applying an edit would be a good way to lose a library.
 *
 * What is deliberately NOT in here: which book sits on which shelf, which books
 * are lying on the table, where the moving boxes have been pushed to, or which
 * lamps are on. All of that is machine-written state and lives beside this file
 * — see `reconcile.ts` for what happens to it when this document changes
 * underneath it. The rule is that nothing the app writes ever lands in the file
 * you are editing.
 */

export const WORLD_SCHEMA_VERSION = 2

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
  /**
   * Whether a pane is fitted. Windows are glazed; a loft balustrade and a
   * porch railing are the same shape — a waist-high apron you can see over and
   * cannot walk through — with nothing in the hole.
   */
  glazed: boolean
}

export type ShelfSpec = {
  /**
   * Stable across edits — this is what the book layout is keyed by. Rename it
   * and the shelf reads as a different shelf, so its books go into boxes.
   */
  id: string
  /** Position in room-local metres, measured from the room's centre. */
  at: [number, number]
  /** Degrees clockwise about Y. 0 faces +Z (south); the front is the open side. */
  facing: number
  rows: number
  /**
   * A starting label for the case, written on a card on its top edge. You can
   * relabel a shelf in the app, and that overrides this — the app's labels live
   * in `books.json` so that hand edits and app edits never fight over a file.
   */
  label?: string
}

/**
 * Everything that stands in a room.
 *
 * The list has grown past "a chair and a rug" because a library you want to be
 * in is not only bookcases: the kitchen, the record player and the picture on
 * the wall are what make it somewhere rather than a warehouse. Each kind is a
 * few boxes and cylinders in `Furniture.tsx` — nothing here is a model file, so
 * the repo stays text and the proportions stay arguable.
 */
export type FurnitureKind =
  // seating and surfaces
  | 'armchair'
  | 'sofa'
  | 'diningchair'
  | 'bench'
  | 'footstool'
  | 'sidetable'
  | 'table'
  // storage
  | 'box'
  | 'recordshelf'
  | 'kitchencounter'
  // things that do something
  | 'recordplayer'
  | 'coffeemaker'
  | 'fireplace'
  // light
  | 'floorlamp'
  | 'pendant'
  // dressing
  | 'rug'
  | 'plant'
  | 'picture'
  // structure
  | 'stairs'

export type FurnitureSpec = {
  id: string
  kind: FurnitureKind
  at: [number, number]
  facing: number
  /**
   * Footprint override, in metres. For a `picture` this is the framed size —
   * width by *height* — because a picture has no depth worth naming.
   */
  size?: [number, number]
  /** Height override, for the kinds where it is worth varying (tables, counters). */
  height?: number
  /** Centre height above the floor. Only pictures hang. */
  y?: number
  /**
   * Which file in `artwork/` a picture shows. Omitted, pictures are dealt out
   * of the folder in document order, so dropping images in is enough.
   */
  source?: string
  /** How far a flight of stairs climbs. Its `size` is [width, run]. */
  rise?: number
  /**
   * Whether a lamp starts lit. You can switch lights in the app, and that is
   * remembered in `.library/lights.json` — this is only the initial state.
   */
  on?: boolean
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
   * Height of this room's floor above the world's ground plane. A loft is a
   * room with an elevation, standing over another room's plan — which is why
   * rooms may overlap now, as long as they are on different levels.
   */
  elevation: number
  /** Which walls are built. A porch has none; a loft has three and a balustrade. */
  walls: Wall[]
  /** False for a room whose ceiling is the floor of the room above it. */
  ceiling: boolean
  /** Rectangles missing from the floor, so a stair can come up through it. */
  holes: FloorHole[]
  floor: FloorFinish
  /** True for a porch: no interior lighting, and it is not "inside". */
  outdoor: boolean
  openings: Opening[]
  shelves: ShelfSpec[]
  furniture: FurnitureSpec[]
}

export type WorldDocument = {
  schemaVersion: number
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

/**
 * An id, which is used as part of a `shelfId:row` key in the book layout — so a
 * colon in one would make that key ambiguous and quietly misplace books.
 */
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

export const FURNITURE_KINDS = [
  'armchair',
  'sofa',
  'diningchair',
  'bench',
  'footstool',
  'sidetable',
  'table',
  'box',
  'recordshelf',
  'kitchencounter',
  'recordplayer',
  'coffeemaker',
  'fireplace',
  'floorlamp',
  'pendant',
  'rug',
  'plant',
  'picture',
  'stairs',
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

function parseHole(raw: unknown, path: string): FloorHole {
  const source = object(raw, path)
  const size = pair(source, 'size', path)
  if (size[0] <= 0 || size[1] <= 0) {
    fail(`${path}.size`, `expected a positive width and depth, found [${size[0]}, ${size[1]}]`)
  }
  return { at: pair(source, 'at', path), size }
}

/**
 * Which walls to build. Omitted means all four, because that is what a room is;
 * an explicit empty list is a porch, and is deliberately allowed.
 */
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
 * Parse and check a world document. Throws `WorldError` with the offending
 * path; callers surface that verbatim, because "rooms[1].shelves[3].at:
 * expected two numbers like [x, z]" is a fixable message and "invalid" is not.
 */
export function parseWorld(raw: unknown): WorldDocument {
  const source = object(raw, '')

  const version = num(source, 'schemaVersion', '', WORLD_SCHEMA_VERSION)
  if (version > WORLD_SCHEMA_VERSION) {
    fail(
      'schemaVersion',
      `this document is version ${version} but this build only understands ` +
        `${WORLD_SCHEMA_VERSION} — a newer version of the app wrote it`,
    )
  }

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
    schemaVersion: WORLD_SCHEMA_VERSION,
    name: typeof source.name === 'string' ? source.name : 'Library',
    spawn,
    rooms,
  }
}

/**
 * Strip `//` and block comments, so the file you hand-edit can explain itself.
 *
 * Comments are replaced by spaces rather than removed, which keeps every
 * character at its original offset — otherwise `JSON.parse`'s "position 412"
 * would point somewhere that is not where you typed the mistake.
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
