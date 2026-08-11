import { create } from 'zustand'
import { library } from '../services'
import type { IndexedBook, LayoutDocument, ScanProgress, ScanSummary } from '../services/types'
import { dimensionsFor, hashId, type BookDimensions } from '../data/dimensions'
import { mulberry32 } from '../lib/rng'
import {
  arrangeInto,
  emptyRowsFirst,
  packLayout,
  packRow,
  rowFits,
  rowKey,
  type PackedBook,
  type RowKey,
} from '../scene/shelving'
import type { DerivedWorld } from '../world/derive'
import { boxesIn } from '../world/boxes'
import {
  LAYOUT_SCHEMA_VERSION,
  describeReconciliation,
  reconcile,
  type Reconciliation,
} from '../world/reconcile'
import { useWorldStore } from './world'

const SAVE_DEBOUNCE_MS = 600

type LibraryState = {
  books: IndexedBook[]
  byId: Map<string, IndexedBook>
  dims: Map<string, BookDimensions>

  /**
   * Exactly what is in `books.json`, including rows whose shelf is not in the
   * world right now.
   *
   * Keeping those is what makes an edit reversible: delete a bookcase and its
   * books go into boxes, put it back and they return to it. If reconciliation
   * were allowed to prune this, a mistyped edit followed by an undo would leave
   * the arrangement gone for good.
   */
  savedRows: Record<RowKey, string[]>
  /** Which box each book was deliberately put in, as written down. */
  savedBoxes: Record<string, string[]>
  /** False until a layout has been read from or written to disk. */
  hasSavedLayout: boolean
  /** The reconciled, live arrangement — only rows that exist in this world. */
  rows: Record<RowKey, string[]>
  packed: PackedBook[]
  /** Box furniture id -> the books in it, bottom of the pile first. */
  boxes: Record<string, string[]>
  /** Every book in a box, box by box. The unshelved half of the library. */
  boxed: string[]
  /** What the last reconciliation cost, for the panel. Null when it cost nothing. */
  reconciliation: string | null
  /** Book id -> bookmarked spreads, ascending. Saved beside the layout. */
  bookmarks: Record<string, number[]>

  loaded: boolean
  scanning: boolean
  progress: ScanProgress | null
  lastScan: ScanSummary | null
  error: string | null

  load: () => Promise<void>
  scan: () => Promise<void>
  /** Recompute against the current world. Called when `library.json` changes. */
  rebuild: () => void
  /** Take a book off its shelf, or out of a box. Returns false if it had neither. */
  unshelve: (id: string) => boolean
  /** Put a book into a row. Returns false if it will not fit. */
  shelve: (id: string, shelfId: string, row: number, index: number) => boolean
  /** Drop a book into a box, on top of the pile. Returns false if there is no such box. */
  putInBox: (id: string, boxId: string) => boolean
  /**
   * Unpack a box onto the shelves. Returns how many books found a shelf;
   * whatever did not fit is still in the box.
   */
  emptyBoxOntoShelves: (boxId: string) => number
  /** Add or remove a bookmark at `spread`. Returns true if one is now there. */
  toggleBookmark: (bookId: string, spread: number) => boolean
  bookAt: (id: string) => IndexedBook | undefined
  dimensionsOf: (id: string) => BookDimensions | undefined
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** The world, or a stand-in with no shelves at all if it has not loaded yet. */
function currentWorld(): DerivedWorld | null {
  return useWorldStore.getState().world
}

function project(
  world: DerivedWorld | null,
  result: Reconciliation,
  dims: Map<string, BookDimensions>,
) {
  const lookup = (id: string) => dims.get(id)
  return {
    rows: result.rows,
    packed: world ? packLayout(world, result.rows, lookup) : [],
    boxes: result.boxes,
    boxed: result.boxed,
    reconciliation: describeReconciliation(result),
  }
}

/** Every list in the map with these ids taken out, dropping any that empty. */
function without(
  map: Record<string, string[]>,
  ids: ReadonlySet<string>,
): Record<string, string[]> {
  const next: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(map)) {
    const kept = value.filter((id) => !ids.has(id))
    if (kept.length) next[key] = kept
  }
  return next
}

/** The flat unshelved list, in box order, so the pile is packed the same way. */
function flatten(world: DerivedWorld | null, boxes: Record<string, string[]>): string[] {
  const order = world ? boxesIn(world).map((box) => box.id) : Object.keys(boxes)
  return order.flatMap((boxId) => boxes[boxId] ?? [])
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  /** Persist the layout, coalescing the bursts that come from moving books. */
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const document: LayoutDocument = {
        schemaVersion: LAYOUT_SCHEMA_VERSION,
        rows: get().savedRows,
        boxes: get().savedBoxes,
        bookmarks: get().bookmarks,
      }
      void library.saveLayout(document).catch((e) => set({ error: String(e) }))
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * Remember a placement in the saved layout as well as the live one.
   *
   * A book is in exactly one place, so writing it down anywhere takes it out of
   * everywhere else. Rows for shelves this world does not have are carried
   * through untouched — see `savedRows`.
   */
  const remember = (
    id: string,
    to: { key: RowKey; index: number } | { boxId: string } | null,
  ) => {
    const one = new Set([id])
    const savedRows = without(get().savedRows, one)
    const savedBoxes = without(get().savedBoxes, one)

    if (to && 'key' in to) {
      const existing = savedRows[to.key] ?? []
      const at = Math.max(0, Math.min(to.index, existing.length))
      savedRows[to.key] = [...existing.slice(0, at), id, ...existing.slice(at)]
    } else if (to) {
      savedBoxes[to.boxId] = [...(savedBoxes[to.boxId] ?? []), id]
    }

    return { savedRows, savedBoxes }
  }

  return {
    books: [],
    byId: new Map(),
    dims: new Map(),
    savedRows: {},
    savedBoxes: {},
    hasSavedLayout: false,
    rows: {},
    packed: [],
    boxes: {},
    boxed: [],
    reconciliation: null,
    bookmarks: {},

    loaded: false,
    scanning: false,
    progress: null,
    lastScan: null,
    error: null,

    bookAt: (id) => get().byId.get(id),
    dimensionsOf: (id) => get().dims.get(id),

    load: async () => {
      try {
        const [books, layout] = await Promise.all([library.listBooks(), library.loadLayout()])
        const byId = new Map(books.map((b) => [b.id, b]))
        const dims = new Map(books.map((b) => [b.id, dimensionsFor(b)]))
        const known = new Set(books.map((b) => b.id))

        // Drop only ids the index no longer has — a deleted file, not a moved
        // shelf. Everything else is kept, including rows this world lacks.
        const savedRows: Record<RowKey, string[]> = {}
        for (const [key, ids] of Object.entries(layout?.rows ?? {})) {
          const kept = ids.filter((id) => known.has(id))
          if (kept.length) savedRows[key] = kept
        }

        // Same for boxes: a box missing from the room keeps its entry, so
        // putting it back puts its books back in it.
        const savedBoxes: Record<string, string[]> = {}
        for (const [boxId, ids] of Object.entries(layout?.boxes ?? {})) {
          const kept = ids.filter((id) => known.has(id))
          if (kept.length) savedBoxes[boxId] = kept
        }

        // A bookmark in a book the index has lost is a bookmark in nothing.
        const bookmarks: Record<string, number[]> = {}
        for (const [id, spreads] of Object.entries(layout?.bookmarks ?? {})) {
          if (known.has(id) && spreads.length) bookmarks[id] = [...spreads].sort((a, b) => a - b)
        }

        set({
          books,
          byId,
          dims,
          savedRows,
          savedBoxes,
          bookmarks,
          hasSavedLayout: layout !== null,
          loaded: true,
          error: null,
        })
        get().rebuild()
      } catch (e) {
        set({ loaded: true, error: e instanceof Error ? e.message : String(e) })
      }
    },

    rebuild: () => {
      const { books, dims, savedRows, savedBoxes, hasSavedLayout, loaded } = get()
      if (!loaded) return
      const world = currentWorld()
      // Nothing to stand books on yet. `load` runs after the world in practice,
      // and the world store's subscription calls back here if it does not.
      if (!world) return

      const result = reconcile(
        world,
        hasSavedLayout
          ? { schemaVersion: LAYOUT_SCHEMA_VERSION, rows: savedRows, boxes: savedBoxes }
          : null,
        books.map((b) => b.id),
        (id) => dims.get(id),
      )
      set(project(world, result, dims))

      if (!hasSavedLayout) {
        // First run in this folder: everything is in a box, and which box is
        // written down so the piles are the same on the second launch.
        set({ savedRows: result.rows, savedBoxes: result.boxes, hasSavedLayout: true })
        scheduleSave()
      }
      // Otherwise deliberately no save: books that went into boxes are still
      // written down as belonging to the shelf they came from, so putting the
      // bookcase back in `library.json` puts them back on it.
    },

    toggleBookmark: (bookId, spread) => {
      const existing = get().bookmarks[bookId] ?? []
      const already = existing.includes(spread)
      const next = already
        ? existing.filter((s) => s !== spread)
        : [...existing, spread].sort((a, b) => a - b)

      const bookmarks = { ...get().bookmarks }
      if (next.length) bookmarks[bookId] = next
      else delete bookmarks[bookId]

      set({ bookmarks })
      scheduleSave()
      return !already
    },

    scan: async () => {
      if (get().scanning) return
      set({ scanning: true, progress: null, error: null })
      const stop = library.onScanProgress((progress) => set({ progress }))
      try {
        const lastScan = await library.scan()
        set({ lastScan })
        await get().load()
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      } finally {
        stop()
        set({ scanning: false, progress: null })
      }
    },

    unshelve: (id) => {
      const { rows, boxes, dims, boxed } = get()
      const world = currentWorld()
      const one = new Set([id])

      // Taking a book out of a box is a legitimate way to pick one up, and it
      // has to leave the box or you could take the same book forever.
      const onShelf = Object.values(rows).some((ids) => ids.includes(id))
      if (!onShelf && !boxed.includes(id)) return false

      const next = without(rows, one)
      const nextBoxes = without(boxes, one)

      set({
        ...remember(id, null),
        rows: next,
        packed: world ? packLayout(world, next, (x) => dims.get(x)) : [],
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
      return true
    },

    shelve: (id, shelfId, row, index) => {
      const { rows, boxes, dims } = get()
      const world = currentWorld()
      const key = rowKey(shelfId, row)
      const existing = (rows[key] ?? []).filter((x) => x !== id)
      const at = Math.max(0, Math.min(index, existing.length))
      const candidate = [...existing.slice(0, at), id, ...existing.slice(at)]

      if (!rowFits(candidate, (x) => dims.get(x))) return false

      const one = new Set([id])
      const next = without(rows, one)
      next[key] = candidate
      const nextBoxes = without(boxes, one)

      set({
        ...remember(id, { key, index: at }),
        rows: next,
        packed: world ? packLayout(world, next, (x) => dims.get(x)) : [],
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
      return true
    },

    putInBox: (id, boxId) => {
      const { rows, boxes, dims } = get()
      const world = currentWorld()
      if (!world || !boxesIn(world).some((box) => box.id === boxId)) return false

      const one = new Set([id])
      const next = without(rows, one)
      const nextBoxes = without(boxes, one)
      nextBoxes[boxId] = [...(nextBoxes[boxId] ?? []), id]

      set({
        ...remember(id, { boxId }),
        rows: next,
        packed: world ? packLayout(world, next, (x) => dims.get(x)) : [],
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
      return true
    },

    /**
     * Unpack a box: every book in it onto the shelves, empty ones first.
     *
     * The counterpart to a library that arrives boxed. Doing it a book at a
     * time is the fine-grained way and this is the armful — and because it
     * goes to empty rows in a shuffled order, unpacking four boxes fills the
     * room rather than the first bookcase by the door.
     */
    emptyBoxOntoShelves: (boxId) => {
      const { rows, boxes, dims, savedBoxes } = get()
      const world = currentWorld()
      const ids = boxes[boxId] ?? []
      if (!world || ids.length === 0) return 0

      const lookup = (id: string) => dims.get(id)
      // Seeded on the box, so unpacking one is repeatable rather than a new
      // room every time you look at it.
      const order = emptyRowsFirst(world, rows, mulberry32(hashId(boxId)))
      const arranged = arrangeInto(world, rows, ids, lookup, order)

      const leftOver = new Set(arranged.leftOver)
      const moved = new Set(ids.filter((id) => !leftOver.has(id)))
      if (moved.size === 0) return 0

      // Write down where each book landed, in the order its row took them, so
      // the saved layout and the live one agree.
      const savedRows = without(get().savedRows, moved)
      for (const [key, placed] of Object.entries(arranged.rows)) {
        const arrivals = placed.filter((id) => moved.has(id))
        if (arrivals.length) savedRows[key] = [...(savedRows[key] ?? []), ...arrivals]
      }

      const nextBoxes = without(boxes, moved)
      set({
        savedRows,
        savedBoxes: without(savedBoxes, moved),
        rows: arranged.rows,
        packed: packLayout(world, arranged.rows, lookup),
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
      return moved.size
    },
  }
})

/** Positions for one row as currently laid out — used for insertion targeting. */
export function packedRow(shelfIndex: number, row: number): PackedBook[] {
  const world = useWorldStore.getState().world
  const shelf = world?.shelves[shelfIndex]
  if (!world || !shelf) return []
  const { rows, dims } = useLibraryStore.getState()
  return packRow(shelf, shelfIndex, row, rows[rowKey(shelf.id, row)] ?? [], (id) => dims.get(id))
}

/**
 * Re-reconcile whenever a new world document is applied.
 *
 * Subscribed at module scope rather than from a component, because the books
 * have to follow the room even if nothing is currently rendering them.
 */
useWorldStore.subscribe((state, previous) => {
  if (state.revision !== previous.revision) useLibraryStore.getState().rebuild()
})
