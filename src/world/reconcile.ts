import type { BookDimensions } from '../data/dimensions'
import { ROW_CAPACITY, parseRowKey, rowKey, type RowKey } from '../scene/shelving'
import { boxesIn } from './boxes'
import type { DerivedWorld, SpawnedBox } from './derive'

/**
 * Where books go when the room or the index changes underneath them. Two rules:
 * a book nobody placed goes in a box, and a book placed by hand is never moved.
 * Displacement is always visible, into the boxes, never silent.
 *
 *   - shelf still there, book still fits    -> stays where it was
 *   - shelf gone, renamed, or lost that row -> displaced, to a box
 *   - row no longer holds it (narrower case,
 *     fatter book after a re-index)         -> displaced, to a box
 *   - new since the last layout             -> to a box
 *   - its box is gone                       -> to whichever boxes remain
 */

export type BookLayout = {
  /** `shelfId:row` -> ordered book ids. */
  rows: Record<RowKey, string[]>
  /** Furniture id of a box -> the books in it, bottom of the pile first. */
  boxes?: Record<string, string[]>
  /**
   * Books put down in the room. Only the ids matter here — a loose book counts
   * as placed, so a rescan must not sweep it into a box.
   */
  loose?: Record<string, unknown>
}

export type Reconciliation = {
  rows: Record<RowKey, string[]>
  /** Box furniture id -> the books in it, in stacking order. */
  boxes: Record<string, string[]>
  /** Books that had a place on a shelf and lost it. In boxes now. */
  displaced: string[]
  /** Books the layout had never placed anywhere. In boxes too. */
  fresh: string[]
  /** Everything in a box, box by box. Empty of boxes, everything unshelved. */
  boxed: string[]
  /** True when this was a library with no saved layout at all. */
  firstRun: boolean
  /**
   * Box furniture id -> folder name, for a box that took fresh arrivals from
   * exactly one folder under One Box per Folder. A box that took more than one
   * — boxes ran short — is left out rather than mislabelled with either name.
   */
  folderLabels: Record<string, string>
}

/** Spread books level across the boxes: a fuller box takes fewer, not round robin. */
function distribute(
  boxes: Record<string, string[]>,
  boxIds: readonly string[],
  ids: readonly string[],
) {
  if (boxIds.length === 0) return
  for (const id of ids) {
    let target = boxIds[0]!
    for (const boxId of boxIds) {
      if ((boxes[boxId]?.length ?? 0) < (boxes[target]?.length ?? 0)) target = boxId
    }
    ;(boxes[target] ??= []).push(id)
  }
}

/**
 * The folder a book packs by. The top level under `books/` when there is one,
 * since that is where people sort, with subfolders grouped under their parent;
 * otherwise the file's own directory. Root-level files return '' and pack together.
 */
export function bookFolder(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/')
  const marker = parts.lastIndexOf('books')
  if (marker >= 0 && marker < parts.length - 1) {
    return parts.length - marker === 2 ? '' : parts[marker + 1]!
  }
  return parts.length > 1 ? parts[parts.length - 2]! : ''
}

/**
 * Like `distribute` but whole folders at a time, so unpacking a box is unpacking
 * a subject. Biggest folder first into the emptiest box; a folder is never split.
 * Returns which folders landed in which box, so a box that took exactly one can
 * be labelled with it.
 */
function distributeByFolder(
  boxes: Record<string, string[]>,
  boxIds: readonly string[],
  ids: readonly string[],
  folderOf: (id: string) => string,
): Map<string, Set<string>> {
  const landed = new Map<string, Set<string>>()
  if (boxIds.length === 0) return landed
  const folders = new Map<string, string[]>()
  for (const id of ids) {
    const key = folderOf(id)
    const list = folders.get(key)
    if (list) list.push(id)
    else folders.set(key, [id])
  }

  const bySize = [...folders.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [name, group] of bySize) {
    let target = boxIds[0]!
    for (const boxId of boxIds) {
      if ((boxes[boxId]?.length ?? 0) < (boxes[target]?.length ?? 0)) target = boxId
    }
    ;(boxes[target] ??= []).push(...group)
    const names = landed.get(target)
    if (names) names.add(name)
    else landed.set(target, new Set([name]))
  }
  return landed
}

/**
 * Reconcile a saved layout against the world and index as they are now. A book
 * whose file was deleted is gone rather than displaced. `folderOf` turns "One
 * Box per Folder" on, which shapes arrivals only — displaced books still level out.
 */
export function reconcile(
  world: DerivedWorld,
  saved: BookLayout | null,
  books: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
  folderOf?: (id: string) => string,
): Reconciliation {
  const known = new Set(books)
  const validRows = new Set<RowKey>()
  for (const shelf of world.shelves) {
    for (let row = 0; row < shelf.rows; row++) validRows.add(rowKey(shelf.id, row))
  }

  const rows: Record<RowKey, string[]> = {}
  const displaced: string[] = []
  /** Every id the previous layout mentioned, whether or not it kept its place. */
  const wasPlaced = new Set<string>()

  // A book is in exactly one place. A hand-edited or corrupt layout can list
  // the same id twice; first mention wins, or it renders twice.
  const claimed = new Set<string>()

  // A loose book beats a row or box copy of the same id: where it was last put
  // down is the most recent placement a person made.
  const loose = new Set(Object.keys(saved?.loose ?? {}))

  for (const [key, ids] of Object.entries(saved?.rows ?? {})) {
    for (const id of ids) wasPlaced.add(id)

    // A key that is not a valid row means the shelf was deleted or renamed, or
    // the case lost rows. Either way every book on it has lost its home.
    const parsed = parseRowKey(key)
    if (!parsed || !validRows.has(key)) {
      const lost = ids.filter((id) => known.has(id) && !claimed.has(id) && !loose.has(id))
      for (const id of lost) claimed.add(id)
      displaced.push(...lost)
      continue
    }

    // Re-pack the row: a narrower case or a book that grew after a re-index can
    // push the tail out, and the tail is displaced rather than silently lost.
    const kept: string[] = []
    let used = 0
    for (const id of ids) {
      if (!known.has(id) || claimed.has(id) || loose.has(id)) continue
      const size = dims(id)
      if (!size) continue
      claimed.add(id)
      if (used + size.thickness > ROW_CAPACITY) {
        displaced.push(id)
        continue
      }
      kept.push(id)
      used += size.thickness
    }
    if (kept.length) rows[key] = kept
  }

  // A loose book counts as placed, so a rescan does not tidy it away. Marked
  // before the boxes are read so loose wins if a document claims both.
  for (const id of Object.keys(saved?.loose ?? {})) wasPlaced.add(id)

  // Which books are in which box. A box that has been taken out of the document
  // tips its books into the ones that are left, rather than losing them.
  const boxIds = boxesIn(world).map((box) => box.id)
  const present = new Set(boxIds)
  const boxes: Record<string, string[]> = {}
  const orphaned: string[] = []

  for (const [boxId, ids] of Object.entries(saved?.boxes ?? {})) {
    // A shelved book is not also in a box; the shelf is the later placement.
    const kept = ids.filter((id) => known.has(id) && !wasPlaced.has(id))
    for (const id of ids) wasPlaced.add(id)
    if (!kept.length) continue
    if (present.has(boxId)) boxes[boxId] = kept
    else orphaned.push(...kept)
  }

  // Books the layout never mentioned are new, and new books arrive in boxes.
  const fresh = books.filter((id) => !wasPlaced.has(id))
  distribute(boxes, boxIds, [...displaced, ...orphaned])
  const landed: Map<string, Set<string>> = folderOf
    ? distributeByFolder(boxes, boxIds, fresh, folderOf)
    : new Map()
  if (!folderOf) distribute(boxes, boxIds, fresh)

  // With no box furniture there is nowhere to show these, but they are still
  // unshelved and still counted.
  const assigned = new Set(Object.values(boxes).flat())
  const homeless = [...displaced, ...orphaned, ...fresh].filter((id) => !assigned.has(id))

  const folderLabels: Record<string, string> = {}
  for (const [boxId, names] of landed) {
    if (names.size !== 1) continue
    const [name] = names
    if (name) folderLabels[boxId] = name
  }

  return {
    rows,
    boxes,
    displaced,
    fresh,
    boxed: [...boxIds.flatMap((boxId) => boxes[boxId] ?? []), ...homeless],
    firstRun: saved === null,
    folderLabels,
  }
}

/** A sentence for the HUD, or null when the edit cost nothing. */
export function describeReconciliation(result: Reconciliation): string | null {
  if (result.displaced.length === 0) return null
  const count = result.displaced.length
  return (
    `${count} book${count === 1 ? '' : 's'} lost ` +
    `${count === 1 ? 'its shelf' : 'their shelves'} — packed into the boxes.`
  )
}

/** Metres between box centres in a spawned grid, along a row and between rows. */
const BOX_GAP = 0.62
/** How close to a wall a spawned box may stand. */
const WALL_MARGIN = 0.45

/**
 * Where the next `count` boxes for One Box per Folder would go: a grid growing
 * out of the existing pile, filling each row to the wall and starting the next
 * one a step toward the middle of the room — clamped to the room, so a big
 * delivery stacks up indoors instead of marching out through a wall. Null
 * spawns nothing, for `count <= 0` or a document with no rooms at all.
 */
export function planFolderBoxSpots(
  world: DerivedWorld,
  spawnedBoxes: Record<string, SpawnedBox>,
  removedBoxes: readonly string[],
  count: number,
): Record<string, SpawnedBox> | null {
  if (count <= 0) return null
  const existing = boxesIn(world)
  const roomId = existing[0]?.roomId ?? world.rooms[0]?.id
  const room = roomId === undefined ? undefined : world.rooms.find((r) => r.id === roomId)
  if (!room) return null

  const halfX = Math.max(room.size[0] / 2 - WALL_MARGIN, BOX_GAP)
  const halfZ = Math.max(room.size[1] / 2 - WALL_MARGIN, BOX_GAP)

  const here = existing.filter((box) => box.roomId === room.id)
  const locals = here.map((box) => [box.x - room.origin[0], box.z - room.origin[1]] as const)
  const xs = locals.map(([lx]) => lx)
  const zs = locals.map(([, lz]) => lz)

  const clamp = (v: number, half: number) => Math.max(-half, Math.min(half, v))

  // Rows run along X from the pile's west edge; each full row wraps to a new
  // one a step deeper into the room, away from whichever wall the pile hugs.
  // With no pile at all the grid starts along the room's south wall.
  const meanZ = zs.length ? zs.reduce((sum, lz) => sum + lz, 0) / zs.length : halfZ
  const step = meanZ > 0 ? -BOX_GAP : BOX_GAP
  const rowStart = clamp(xs.length ? Math.min(...xs) : -halfX, halfX)
  // The pile's leading edge in the step direction, so the first wrapped row
  // clears the pile instead of standing in it.
  const pileEdge = zs.length ? (step < 0 ? Math.min(...zs) : Math.max(...zs)) : halfZ
  let x = Math.max(rowStart, xs.length ? Math.max(...xs) : -halfX)
  let z = clamp(pileEdge, halfZ)
  const facing = here[0]?.facing ?? 0

  // A broken-down id stays burned, same as a box made by hand off the stack.
  const taken = new Set([
    ...world.furniture.map((item) => item.id),
    ...Object.keys(spawnedBoxes),
    ...removedBoxes,
  ])
  const made: Record<string, SpawnedBox> = { ...spawnedBoxes }
  let n = 1
  for (let i = 0; i < count; i++) {
    x += BOX_GAP
    if (x > halfX) {
      x = rowStart
      z = clamp(z + step, halfZ)
    }
    while (taken.has(`box-${n}`)) n += 1
    const id = `box-${n}`
    taken.add(id)
    // A couple of degrees of disagreement, so a delivery reads as a pile of
    // cardboard rather than a warehouse.
    made[id] = { room: room.id, at: [x, z], facing: facing + (((i * 37) % 13) - 6) }
  }
  return made
}
