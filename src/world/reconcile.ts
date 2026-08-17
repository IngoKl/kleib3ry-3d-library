import type { BookDimensions } from '../data/dimensions'
import { ROW_CAPACITY, parseRowKey, rowKey, type RowKey } from '../scene/shelving'
import { boxesIn } from './boxes'
import type { DerivedWorld } from './derive'

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
 */
function distributeByFolder(
  boxes: Record<string, string[]>,
  boxIds: readonly string[],
  ids: readonly string[],
  folderOf: (id: string) => string,
) {
  if (boxIds.length === 0) return
  const folders = new Map<string, string[]>()
  for (const id of ids) {
    const key = folderOf(id)
    const list = folders.get(key)
    if (list) list.push(id)
    else folders.set(key, [id])
  }

  const bySize = [...folders.values()].sort((a, b) => b.length - a.length)
  for (const group of bySize) {
    let target = boxIds[0]!
    for (const boxId of boxIds) {
      if ((boxes[boxId]?.length ?? 0) < (boxes[target]?.length ?? 0)) target = boxId
    }
    ;(boxes[target] ??= []).push(...group)
  }
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
  if (folderOf) distributeByFolder(boxes, boxIds, fresh, folderOf)
  else distribute(boxes, boxIds, fresh)

  // With no box furniture there is nowhere to show these, but they are still
  // unshelved and still counted.
  const assigned = new Set(Object.values(boxes).flat())
  const homeless = [...displaced, ...orphaned, ...fresh].filter((id) => !assigned.has(id))

  return {
    rows,
    boxes,
    displaced,
    fresh,
    boxed: [...boxIds.flatMap((boxId) => boxes[boxId] ?? []), ...homeless],
    firstRun: saved === null,
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
