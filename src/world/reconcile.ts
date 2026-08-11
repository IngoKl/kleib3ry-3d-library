import type { BookDimensions } from '../data/dimensions'
import { ROW_CAPACITY, parseRowKey, rowKey, type RowKey } from '../scene/shelving'
import { boxesIn } from './boxes'
import type { DerivedWorld } from './derive'

/**
 * Where books are when the room, or the index, changes underneath them.
 *
 * Two rules, and the second is the reason the layout is keyed by shelf id.
 *
 * **A book the app has never been told where to put goes in a box.** A newly
 * indexed library is a stack of boxes and empty shelves, because that is what
 * arriving with a collection actually looks like — and because the app choosing
 * an arrangement for a thousand books is a decision it has no business making
 * on your behalf. Shelving them is yours to do, a handful at a time or a boxful
 * at a time (`emptyBoxOntoShelves`).
 *
 * **The app never moves a book you placed.** Editing `library.json` — moving a
 * bookcase, reordering the file, deleting one — must not shuffle a library you
 * have arranged by hand, and the failure mode to avoid is the *silent* one:
 * books quietly reappearing somewhere else.
 *
 *   - shelf still there, book still fits   -> it stays exactly where it was
 *   - shelf gone, renamed, or lost that row -> the book is displaced, to a box
 *   - the row no longer holds it (narrower
 *     case, fatter book after a re-index)   -> displaced, to a box
 *   - book is new since the last layout     -> to a box
 *   - the box it was in is gone             -> to whichever boxes remain
 *
 * "To a box" is the moving boxes on the floor: visible, in your way, and
 * waiting for you to shelve it. Losing an arrangement should look like a house
 * move, not like nothing happened.
 */

export type BookLayout = {
  schemaVersion: number
  /** `shelfId:row` -> ordered book ids. */
  rows: Record<RowKey, string[]>
  /** Furniture id of a box -> the books in it, bottom of the pile first. */
  boxes?: Record<string, string[]>
}

/**
 * 2 rekeyed rows from shelf index to shelf id; 3 added bookmarks; 4 added which
 * box a book is in, and stopped shelving newly indexed books automatically.
 * Older documents still load — every field added since has been optional.
 */
export const LAYOUT_SCHEMA_VERSION = 4

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

/**
 * Spread books across the boxes, keeping them as level as possible.
 *
 * Not round robin: a box that is already fuller than the others should take
 * fewer, so emptying one box does not leave a lopsided pile next to it.
 */
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
 * Reconcile a saved layout against the world and the index as they are now.
 *
 * `books` is the set of book ids the index currently holds — a book whose file
 * has been deleted is simply gone and is not reported as displaced, because
 * nothing about the room displaced it.
 */
export function reconcile(
  world: DerivedWorld,
  saved: BookLayout | null,
  books: readonly string[],
  dims: (id: string) => BookDimensions | undefined,
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

  for (const [key, ids] of Object.entries(saved?.rows ?? {})) {
    for (const id of ids) wasPlaced.add(id)

    // A key that is not a valid row means the shelf was deleted or renamed, or
    // the case lost rows. Either way every book on it has lost its home.
    const parsed = parseRowKey(key)
    if (!parsed || !validRows.has(key)) {
      displaced.push(...ids.filter((id) => known.has(id)))
      continue
    }

    // Re-pack the row: a narrower case or a book that grew after a re-index can
    // push the tail out, and the tail is displaced rather than silently lost.
    const kept: string[] = []
    let used = 0
    for (const id of ids) {
      if (!known.has(id)) continue
      const size = dims(id)
      if (!size) continue
      if (used + size.thickness > ROW_CAPACITY) {
        displaced.push(id)
        continue
      }
      kept.push(id)
      used += size.thickness
    }
    if (kept.length) rows[key] = kept
  }

  // Which books are in which box. A box that has been taken out of the document
  // tips its books into the ones that are left, rather than losing them.
  const boxIds = boxesIn(world).map((box) => box.id)
  const present = new Set(boxIds)
  const boxes: Record<string, string[]> = {}
  const orphaned: string[] = []

  for (const [boxId, ids] of Object.entries(saved?.boxes ?? {})) {
    // A book that is on a shelf is not also in a box; the shelf wins, because
    // that is the placement the person made most recently.
    const kept = ids.filter((id) => known.has(id) && !wasPlaced.has(id))
    for (const id of ids) wasPlaced.add(id)
    if (!kept.length) continue
    if (present.has(boxId)) boxes[boxId] = kept
    else orphaned.push(...kept)
  }

  // Books the index knows that the layout never mentioned are new — from the
  // first scan, or from the latest one — and new books arrive in the boxes.
  const fresh = books.filter((id) => !wasPlaced.has(id))
  distribute(boxes, boxIds, [...displaced, ...orphaned, ...fresh])

  // With no box furniture at all there is nowhere to show them, but they are
  // still unshelved and still have to be counted.
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
