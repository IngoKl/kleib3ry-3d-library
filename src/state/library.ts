import { create } from 'zustand'
import { library } from '../services'
import type {
  BoardStroke,
  IndexedBook,
  LayoutDocument,
  LoosePlacement,
  PinnedSheet,
  RecordPlacement,
  ScanProgress,
  ScanSummary,
} from '../services/types'
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
import { floorAt, supportAt, type DerivedWorld, type FurnitureOverride } from '../world/derive'
import { boxesIn } from '../world/boxes'
import {
  LAYOUT_SCHEMA_VERSION,
  describeReconciliation,
  reconcile,
  type Reconciliation,
} from '../world/reconcile'
import { useWorldStore } from './world'
import { useMediaStore } from './media'
import { useVideoStore } from './video'

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
  /**
   * Books put down somewhere that is not a shelf and not a box: on a table, or
   * on the floor where you dropped them. A third home, and the only one whose
   * position is stored rather than derived — because "there" is the whole
   * point of putting something down.
   */
  loose: Record<string, LoosePlacement>
  /** What the last reconciliation cost, for the panel. Null when it cost nothing. */
  reconciliation: string | null
  /** Book id -> bookmarked spreads, ascending. Saved beside the layout. */
  bookmarks: Record<string, number[]>
  /** Book id -> the spread it was last left open at. */
  readProgress: Record<string, number>
  /** Shelf id -> what is written on its label card. Overrides the document. */
  labels: Record<string, string>
  /**
   * Pages and notes pinned to the walls.
   *
   * A list rather than a map because two sheets have nothing to do with each
   * other and there is no key anybody would look one up by: they are found by
   * pointing at them.
   */
  pins: PinnedSheet[]
  /** Whiteboard id -> what has been drawn on it, oldest stroke first. */
  drawings: Record<string, BoardStroke[]>
  /**
   * Records you have had an opinion about: `filed` is the crate you put one in,
   * `looseRecords` is where you set one down. Everything else is dealt out of
   * the music folder in its own order, so both are usually empty.
   */
  filedRecords: Record<string, string>
  looseRecords: Record<string, RecordPlacement>
  /** Furniture that has been shoved somewhere else. Boxes, in practice. */
  placements: Record<string, FurnitureOverride>

  loaded: boolean
  scanning: boolean
  progress: ScanProgress | null
  lastScan: ScanSummary | null
  error: string | null

  load: () => Promise<void>
  scan: () => Promise<void>
  /** Recompute against the current world. Called when `library.json` changes. */
  rebuild: () => void
  /** Take a book off its shelf, out of a box, or up off the floor. */
  unshelve: (id: string) => boolean
  /** Put a book into a row. Returns false if it will not fit. */
  shelve: (id: string, shelfId: string, row: number, index: number) => boolean
  /** Drop a book into a box, on top of the pile. Returns false if there is no such box. */
  putInBox: (id: string, boxId: string) => boolean
  /** Set a book down in the room — on a table, or on the floor. */
  putDown: (id: string, placement: LoosePlacement) => void
  /** Move a book that is already lying about, as the physics settles it. */
  nudge: (id: string, placement: LoosePlacement) => void
  /**
   * Unpack a box onto the shelves. Returns how many books found a shelf;
   * whatever did not fit is still in the box.
   */
  emptyBoxOntoShelves: (boxId: string) => number
  /**
   * The reverse: every book off every shelf and off the floor, back into the
   * boxes. Returns how many moved.
   */
  packEverything: () => number
  /**
   * Only the strays: every book lying on a *floor* — dropped, tumbled, kicked
   * about — into the nearest box. Books left deliberately on tables stay put.
   * Returns how many were picked up.
   */
  packLooseBooks: () => number
  /** Add or remove a bookmark at `spread`. Returns true if one is now there. */
  toggleBookmark: (bookId: string, spread: number) => boolean
  /** Remember where you got to in a book, so putting it down keeps the page. */
  setProgress: (bookId: string, spread: number) => void
  /** Write on a bookcase's label. An empty string takes the label off again. */
  setLabel: (shelfId: string, text: string) => void
  labelOf: (shelfId: string) => string | null
  /** Stick a sheet up. Its id is generated here, so callers cannot collide. */
  pinUp: (sheet: Omit<PinnedSheet, 'id'>) => PinnedSheet
  /** Take a sheet down, by id. Returns it, so it can go into your hand. */
  unpin: (id: string) => PinnedSheet | undefined
  /** Add a finished stroke to a whiteboard. */
  drawOn: (boardId: string, stroke: BoardStroke) => void
  /** Wipe a whiteboard clean. Returns how many strokes went. */
  wipeBoard: (boardId: string) => number
  /** File a record into a particular crate, and keep it there. */
  fileRecord: (trackId: string, crateId: string) => void
  /** Set a record down somewhere that is not a crate. */
  putRecordDown: (trackId: string, placement: RecordPlacement) => void
  /** Forget where a record was put, so it goes back to its dealt place. */
  freeRecord: (trackId: string) => void
  /** Shove a piece of furniture. Only the moving boxes accept this. */
  moveFurniture: (id: string, at: [number, number], facing: number, elevation?: number) => void
  bookAt: (id: string) => IndexedBook | undefined
  dimensionsOf: (id: string) => BookDimensions | undefined
}

/** Bumped per sheet pinned up, so two in the same millisecond differ. */
let pinCounter = 0

let saveTimer: ReturnType<typeof setTimeout> | undefined
let runSave: (() => Promise<void>) | null = null

/**
 * Write any pending layout save out now instead of at the end of the debounce.
 *
 * The debounce exists to coalesce bursts of shelving; it must not be a window
 * in which closing the app — or re-reading the layout from disk — quietly
 * discards the last thing you did. Callers that are about to read the file
 * (`load`) or lose the page (shutdown) flush first.
 */
export async function flushLayoutSave(): Promise<void> {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  await runSave?.()
}

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

/** The same, for the one-entry-per-book maps. */
function omit<T>(map: Record<string, T>, id: string): Record<string, T> {
  if (!(id in map)) return map
  const next = { ...map }
  delete next[id]
  return next
}

/** The flat unshelved list, in box order, so the pile is packed the same way. */
function flatten(world: DerivedWorld | null, boxes: Record<string, string[]>): string[] {
  const order = world ? boxesIn(world).map((box) => box.id) : Object.keys(boxes)
  return order.flatMap((boxId) => boxes[boxId] ?? [])
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const saveNow = async () => {
    const state = get()
    const document: LayoutDocument = {
      schemaVersion: LAYOUT_SCHEMA_VERSION,
      rows: state.savedRows,
      boxes: state.savedBoxes,
      bookmarks: state.bookmarks,
      progress: state.readProgress,
      loose: state.loose,
      furniture: state.placements,
      labels: state.labels,
      pins: state.pins,
      drawings: state.drawings,
      records: { filed: state.filedRecords, loose: state.looseRecords },
    }
    await library.saveLayout(document).catch((e) => set({ error: String(e) }))
  }
  runSave = saveNow

  /** Persist the layout, coalescing the bursts that come from moving books. */
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void saveNow()
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

    // Anywhere a book goes, it stops being on the floor.
    return { savedRows, savedBoxes, loose: omit(get().loose, id) }
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
    loose: {},
    reconciliation: null,
    bookmarks: {},
    readProgress: {},
    labels: {},
    pins: [],
    drawings: {},
    filedRecords: {},
    looseRecords: {},
    placements: {},

    loaded: false,
    scanning: false,
    progress: null,
    lastScan: null,
    error: null,

    bookAt: (id) => get().byId.get(id),
    dimensionsOf: (id) => get().dims.get(id),
    labelOf: (shelfId) => {
      const written = get().labels[shelfId]
      if (written !== undefined) return written || null
      const world = currentWorld()
      const index = world?.shelfIndex.get(shelfId)
      return index === undefined ? null : (world?.shelves[index]?.label ?? null)
    },

    pinUp: (sheet) => {
      // Counter plus the length, so ids stay unique across a session even after
      // sheets have been taken down — a bare length would reuse one.
      pinCounter += 1
      const made: PinnedSheet = { ...sheet, id: `pin-${Date.now().toString(36)}-${pinCounter}` }
      set({ pins: [...get().pins, made] })
      scheduleSave()
      return made
    },

    unpin: (id) => {
      const found = get().pins.find((sheet) => sheet.id === id)
      if (!found) return undefined
      set({ pins: get().pins.filter((sheet) => sheet.id !== id) })
      scheduleSave()
      return found
    },

    drawOn: (boardId, stroke) => {
      set({ drawings: { ...get().drawings, [boardId]: [...(get().drawings[boardId] ?? []), stroke] } })
      scheduleSave()
    },

    wipeBoard: (boardId) => {
      const gone = get().drawings[boardId]?.length ?? 0
      if (gone === 0) return 0
      set({ drawings: omit(get().drawings, boardId) })
      scheduleSave()
      return gone
    },

    /**
     * Filing, setting down and letting go of a record.
     *
     * All three are one small write, because a record's place is one entry
     * rather than an arrangement: unlike a shelf, a crate has no order worth
     * keeping — see `Records.tsx` for why the rest of the collection is dealt
     * rather than laid out.
     */
    fileRecord: (trackId, crateId) => {
      set({
        filedRecords: { ...get().filedRecords, [trackId]: crateId },
        looseRecords: omit(get().looseRecords, trackId),
      })
      scheduleSave()
    },

    putRecordDown: (trackId, placement) => {
      set({
        looseRecords: { ...get().looseRecords, [trackId]: placement },
        filedRecords: omit(get().filedRecords, trackId),
      })
      scheduleSave()
    },

    freeRecord: (trackId) => {
      const { filedRecords, looseRecords } = get()
      if (!(trackId in filedRecords) && !(trackId in looseRecords)) return
      set({
        filedRecords: omit(filedRecords, trackId),
        looseRecords: omit(looseRecords, trackId),
      })
      scheduleSave()
    },

    load: async () => {
      try {
        // A shelving made moments ago may still be sitting in the debounce;
        // reading the file before it lands would roll the edit back.
        await flushLayoutSave()
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

        const readProgress: Record<string, number> = {}
        for (const [id, spread] of Object.entries(layout?.progress ?? {})) {
          if (known.has(id) && spread > 0) readProgress[id] = spread
        }

        const loose: Record<string, LoosePlacement> = {}
        for (const [id, placement] of Object.entries(layout?.loose ?? {})) {
          if (known.has(id)) loose[id] = placement
        }

        // A page copied out of a book the index has lost is a page of nothing,
        // so it goes; a note is nobody's but yours, and always stays.
        const pins = (layout?.pins ?? []).filter(
          (sheet) => sheet.kind === 'note' || (sheet.bookId !== undefined && known.has(sheet.bookId)),
        )

        const placements = layout?.furniture ?? {}
        // The world has to know where the boxes were pushed to before the books
        // are reconciled against it, or a box's pile is drawn where it used to be.
        useWorldStore.getState().setPlacements(placements)

        set({
          books,
          byId,
          dims,
          savedRows,
          savedBoxes,
          bookmarks,
          readProgress,
          loose,
          labels: layout?.labels ?? {},
          pins,
          drawings: layout?.drawings ?? {},
          // Deliberately not filtered against the music folder: a record whose
          // file is momentarily missing — an unmounted drive, a folder being
          // reorganised — should find its crate again when the file comes back,
          // and an entry for a track nobody has is inert.
          filedRecords: layout?.records?.filed ?? {},
          looseRecords: layout?.records?.loose ?? {},
          placements,
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
      const { books, dims, savedRows, savedBoxes, hasSavedLayout, loaded, loose } = get()
      if (!loaded) return
      const world = currentWorld()
      // Nothing to stand books on yet. `load` runs after the world in practice,
      // and the world store's subscription calls back here if it does not.
      if (!world) return

      const result = reconcile(
        world,
        hasSavedLayout
          ? { schemaVersion: LAYOUT_SCHEMA_VERSION, rows: savedRows, boxes: savedBoxes, loose }
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

    setProgress: (bookId, spread) => {
      if (get().readProgress[bookId] === spread) return
      const readProgress = { ...get().readProgress }
      if (spread > 0) readProgress[bookId] = spread
      else delete readProgress[bookId]
      set({ readProgress })
      scheduleSave()
    },

    setLabel: (shelfId, text) => {
      const trimmed = text.trim()
      const labels = { ...get().labels }
      // An empty label is written down as empty rather than deleted, so that
      // rubbing out a label the document supplied actually rubs it out.
      labels[shelfId] = trimmed
      set({ labels })
      scheduleSave()
    },

    moveFurniture: (id, at, facing, elevation) => {
      const placements = {
        ...get().placements,
        [id]: elevation === undefined ? { at, facing } : { at, facing, elevation },
      }
      set({ placements })
      useWorldStore.getState().setPlacements(placements)
      scheduleSave()
    },

    scan: async () => {
      if (get().scanning) return
      set({ scanning: true, progress: null, error: null })
      const stop = library.onScanProgress((progress) => set({ progress }))
      try {
        const lastScan = await library.scan()
        set({ lastScan })
        // "Scan" means look at the folder again, and the folder is not only
        // books. The other three are walked on demand rather than indexed, so
        // nothing in Rust has to be told — but the lists in front of them were
        // read once at startup, which is why a record or a tape dropped into
        // the folder while the app was open only turned up on the next launch.
        await Promise.all([
          get().load(),
          useMediaStore.getState().load(),
          useVideoStore.getState().load(),
        ])
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      } finally {
        stop()
        set({ scanning: false, progress: null })
      }
    },

    unshelve: (id) => {
      const { rows, boxes, dims, boxed, loose } = get()
      const world = currentWorld()
      const one = new Set([id])

      // Taking a book out of a box is a legitimate way to pick one up, and it
      // has to leave the box or you could take the same book forever. So is
      // picking one up off the table you left it on.
      const onShelf = Object.values(rows).some((ids) => ids.includes(id))
      if (!onShelf && !boxed.includes(id) && !(id in loose)) return false

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

    putDown: (id, placement) => {
      const { rows, boxes, dims } = get()
      const world = currentWorld()
      const one = new Set([id])
      const next = without(rows, one)
      const nextBoxes = without(boxes, one)

      set({
        ...remember(id, null),
        loose: { ...get().loose, [id]: placement },
        rows: next,
        packed: world ? packLayout(world, next, (x) => dims.get(x)) : [],
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
    },

    nudge: (id, placement) => {
      if (!(id in get().loose)) return
      set({ loose: { ...get().loose, [id]: placement } })
      scheduleSave()
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

    /**
     * Strip the shelves: everything back into the boxes.
     *
     * The one destructive command in the app, and the reason it exists is that
     * rearranging a library by hand is worth being able to start over on. It
     * goes through the same reconciliation a brand-new library does, so the
     * result is the state you were in the first time you opened the folder —
     * boxes spread evenly, shelves bare — rather than a special case.
     */
    packEverything: () => {
      const { books, dims } = get()
      const world = currentWorld()
      if (!world) return 0
      const before = Object.values(get().rows).flat().length + Object.keys(get().loose).length

      const result = reconcile(
        world,
        { schemaVersion: LAYOUT_SCHEMA_VERSION, rows: {}, boxes: {} },
        books.map((b) => b.id),
        (id) => dims.get(id),
      )

      set({
        ...project(world, result, dims),
        savedRows: {},
        savedBoxes: result.boxes,
        loose: {},
        // Reconciliation reports "everything is new", which is true of the
        // arrangement and would read as an alarm about the shelves. It was not
        // an accident: it is what was asked for.
        reconciliation: null,
      })
      scheduleSave()
      return before
    },

    packLooseBooks: () => {
      const { loose, boxes, savedRows, savedBoxes } = get()
      const world = currentWorld()
      if (!world) return 0
      const crates = boxesIn(world)
      if (crates.length === 0) return 0

      // A book on a table was *left* there; a book whose only support is the
      // floor is a stray. The physics settled each one before its placement was
      // stored, so the stored height is trustworthy.
      const strays = Object.entries(loose).filter(([, at]) => {
        const floor = floorAt(world, at.x, at.z, at.y + 0.1)
        if (floor === null) return true
        return supportAt(world, at.x, at.z, at.y + 0.1) <= floor + 0.02
      })
      if (strays.length === 0) return 0

      const nearestCrate = (x: number, z: number) => {
        let best = crates[0]!.id
        let score = Infinity
        for (const crate of crates) {
          const d = (crate.x - x) ** 2 + (crate.z - z) ** 2
          if (d < score) {
            score = d
            best = crate.id
          }
        }
        return best
      }

      const moved = new Set(strays.map(([id]) => id))
      const nextLoose = { ...loose }
      const nextBoxes = without(boxes, moved)
      const nextSavedBoxes = without(savedBoxes, moved)
      for (const [id, at] of strays) {
        delete nextLoose[id]
        const boxId = nearestCrate(at.x, at.z)
        nextBoxes[boxId] = [...(nextBoxes[boxId] ?? []), id]
        nextSavedBoxes[boxId] = [...(nextSavedBoxes[boxId] ?? []), id]
      }

      set({
        savedRows: without(savedRows, moved),
        savedBoxes: nextSavedBoxes,
        loose: nextLoose,
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

// Closing the window inside the debounce must not lose the last shelving.
// `pagehide` is the reliable end-of-page signal; `beforeunload` is belt and
// braces for the WebView. The save is fire-and-forget — there is no keeping a
// page alive for it — but the IPC message is away before teardown.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushLayoutSave())
  window.addEventListener('beforeunload', () => void flushLayoutSave())
}
