/**
 * The world document: `library.json` in your library folder.
 *
 * This is the file you edit by hand, so parsing is written for the person
 * making the mistake rather than for the machine — every failure names the path
 * that is wrong and what was expected there. A document that does not parse is
 * *rejected whole*: the room already on screen keeps running and the error goes
 * to the HUD. Half-applying an edit would be a good way to lose a library.
 *
 * What is deliberately NOT in here: which book sits on which shelf. That lives
 * in `books.json` beside it, keyed by shelf id, because nobody wants 1,700 book
 * ids in the file they are hand-editing. See `reconcile.ts` for what happens to
 * those books when this document changes underneath them.
 */

export const WORLD_SCHEMA_VERSION = 1

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
}

export type FurnitureKind =
  | 'armchair'
  | 'footstool'
  | 'sidetable'
  | 'rug'
  | 'floorlamp'
  | 'box'

export type FurnitureSpec = {
  id: string
  kind: FurnitureKind
  at: [number, number]
  facing: number
  /** Rugs are the only thing whose footprint is worth varying. */
  size?: [number, number]
}

export type RoomSpec = {
  id: string
  name: string
  /** Room centre in world metres. Rooms are axis-aligned and must not overlap. */
  origin: [number, number]
  /** Width along X, depth along Z. */
  size: [number, number]
  height: number
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
const FURNITURE_KINDS = [
  'armchair',
  'footstool',
  'sidetable',
  'rug',
  'floorlamp',
  'box',
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
  }
}

function parseShelf(raw: unknown, path: string): ShelfSpec {
  const source = object(raw, path)
  const rows = positive(source, 'rows', path, 5)
  if (!Number.isInteger(rows)) fail(`${path}.rows`, `expected a whole number, found ${rows}`)
  return {
    id: identifier(source, 'id', path),
    at: pair(source, 'at', path),
    facing: num(source, 'facing', path, 0),
    rows,
  }
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
  return spec
}

function parseRoom(raw: unknown, path: string): RoomSpec {
  const source = object(raw, path)
  const id = identifier(source, 'id', path)
  const size = pair(source, 'size', path)
  if (size[0] <= 0 || size[1] <= 0) {
    fail(`${path}.size`, `expected positive width and depth, found [${size[0]}, ${size[1]}]`)
  }

  return {
    id,
    name: typeof source.name === 'string' ? source.name : id,
    origin: pair(source, 'origin', path),
    size,
    height: positive(source, 'height', path, 3.2),
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
