import { create } from 'zustand'
import { library } from '../services'
import type {
  BoardStroke,
  IndexedBook,
  LayoutDocument,
  LoosePlacement,
  PinnedSheet,
  PlacedProp,
  RecordPlacement,
  ScanProgress,
  ScanSummary,
} from '../services/types'
import { dimensionsFor, hashId, type BookDimensions } from '../data/dimensions'
import { mulberry32 } from '../lib/rng'
import {
  arrangeInto,
  emptyRowsFirst,
  nearestRowsFirst,
  packLayout,
  packRow,
  rowFits,
  rowKey,
  type PackedBook,
  type RowKey,
} from '../scene/shelving'
import {
  floorAt,
  roomAt,
  supportAt,
  type DerivedWorld,
  type FurnitureOverride,
  type SpawnedBox,
} from '../world/derive'
import { boxesIn } from '../world/boxes'
import {
  bookFolder,
  describeReconciliation,
  planFolderBoxSpots,
  reconcile,
  type Reconciliation,
} from '../world/reconcile'
import { useSettings } from './settings'
import { useWorldStore } from './world'
import { useMediaStore } from './media'
import { useVideoStore } from './video'
import { useArcadeStore } from './arcade'

const SAVE_DEBOUNCE_MS = 600

type LibraryState = {
  books: IndexedBook[]
  byId: Map<string, IndexedBook>
  dims: Map<string, BookDimensions>

  /**
   * Exactly what is in `books.json`, rows for absent shelves included — which is
   * what makes deleting a bookcase reversible.
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
  /** A third home, and the only one whose position is stored rather than derived. */
  loose: Record<string, LoosePlacement>
  /** What the last reconciliation cost, for the panel. Null when it cost nothing. */
  reconciliation: string | null
  /** Book id -> the spread it was last left open at. */
  readProgress: Record<string, number>
  /** Shelf id -> what is written on its label card. Overrides the document. */
  labels: Record<string, string>
  /** A list, not a map: sheets are found by pointing, so there is no key to look one up by. */
  pins: PinnedSheet[]
  /** Whiteboard id -> what has been drawn on it, oldest stroke first. */
  drawings: Record<string, BoardStroke[]>
  /**
   * Records that have been moved. Everything else is dealt from `music/` in
   * folder order, so both of these are usually empty.
   */
  filedRecords: Record<string, string>
  looseRecords: Record<string, RecordPlacement>
  /** The small props standing about the room. Positions stored, like `loose`. */
  props: Record<string, PlacedProp>
  /** Furniture that has been shoved somewhere else. Boxes, in practice. */
  placements: Record<string, FurnitureOverride>
  /** Boxes made up off the stack in the kitchen, by the id given to each. */
  spawnedBoxes: Record<string, SpawnedBox>
  /** Document boxes that have been broken down. */
  removedBoxes: string[]

  loaded: boolean
  scanning: boolean
  progress: ScanProgress | null
  /** When the running scan began, `performance.now()`, for the time-left estimate. */
  scanStarted: number | null
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
  /** Returns how many found a shelf; whatever did not fit is still in the box. */
  emptyBoxOntoShelves: (boxId: string) => number
  /** The reverse: every book off every shelf and floor, back into the boxes. */
  packEverything: () => number
  /** Every book on a floor into the nearest box; books left on tables stay put. */
  packLooseBooks: () => number
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
  /** The cup always lands under its one id; anything else gets a fresh one. */
  placeProp: (prop: PlacedProp) => string
  /** Take a prop off whatever it stands on. Returns it, so it can go into your hand. */
  removeProp: (id: string) => PlacedProp | undefined
  /** Shove a piece of furniture. Only the moving boxes accept this. */
  moveFurniture: (id: string, at: [number, number], facing: number, elevation?: number) => void
  /** Every id is fresh, so two boxes can never fight over one layout entry. */
  spawnBox: (x: number, z: number, facing: number, elevation: number) => string | null
  /** Only an empty box goes: a boxful is not something to vanish with a keystroke. */
  deleteBox: (boxId: string) => boolean
  bookAt: (id: string) => IndexedBook | undefined
  dimensionsOf: (id: string) => BookDimensions | undefined
}

/**
 * What `carried` holds for a box off the kitchen stack, which becomes real
 * furniture when set down. Starts with `#` so it cannot collide with a document id.
 */
export const NEW_BOX = '#new-box'

/** Bumped per sheet pinned up, so two in the same millisecond differ. */
let pinCounter = 0

/** The same, for cans and takeaway boxes as they arrive. */
let propCounter = 0

let saveTimer: ReturnType<typeof setTimeout> | undefined
let runSave: (() => Promise<void>) | null = null

/**
 * True while `rebuild` or `packEverything` is mid-run, so a box spawned for
 * One Box per Folder does not re-enter through the world revision subscriber.
 */
let rebuilding = false

/**
 * Write any pending layout save now. Callers about to read the file or lose the
 * page flush first, so the debounce cannot swallow the last edit.
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

/** A setting rather than a library fact, so it is read when packing, not stored. */
const leaning = () => useSettings.getState().booksLean

function project(
  world: DerivedWorld | null,
  result: Reconciliation,
  dims: Map<string, BookDimensions>,
) {
  const lookup = (id: string) => dims.get(id)
  return {
    rows: result.rows,
    packed: world ? packLayout(world, result.rows, lookup, leaning()) : [],
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
      rows: state.savedRows,
      boxes: state.savedBoxes,
      progress: state.readProgress,
      loose: state.loose,
      furniture: state.placements,
      spawnedBoxes: state.spawnedBoxes,
      removedBoxes: state.removedBoxes,
      labels: state.labels,
      pins: state.pins,
      drawings: state.drawings,
      records: { filed: state.filedRecords, loose: state.looseRecords },
      props: state.props,
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
   * Spawns `needed` boxes where `planFolderBoxSpots` puts them and hands back
   * the world they stand in. `setBoxEdits` bumps the world's revision, which
   * re-enters `rebuild` through the subscription below — harmless, since
   * `rebuilding` makes that re-entry a no-op, but the reason this lives beside
   * `rebuild` rather than further out.
   */
  const growFolderBoxes = (world: DerivedWorld, needed: number): DerivedWorld => {
    const made = planFolderBoxSpots(world, get().spawnedBoxes, get().removedBoxes, needed)
    if (!made) return world
    set({ spawnedBoxes: made })
    useWorldStore.getState().setBoxEdits({ spawned: made, removed: get().removedBoxes })
    scheduleSave()
    return currentWorld() ?? world
  }

  /**
   * Boxes One Box per Folder filled from exactly one subject get that subject
   * as their label. On a scan a label already written down — hand-picked or
   * rubbed out — wins over a guess from a folder name; a full repack
   * (`overwrite`) renames instead, because the box no longer holds whatever
   * the old label named.
   */
  const applyFolderLabels = (folderLabels: Record<string, string>, overwrite = false) => {
    const current = get().labels
    let labels: Record<string, string> | null = null
    for (const [boxId, name] of Object.entries(folderLabels)) {
      if (current[boxId] === name) continue
      if (current[boxId] !== undefined && !overwrite) continue
      labels ??= { ...current }
      labels[boxId] = name
    }
    if (!labels) return
    set({ labels })
    scheduleSave()
  }

  /**
   * Remember a placement in the saved layout as well as the live one. A book is
   * in one place, so writing it anywhere removes it from everywhere else; rows
   * for shelves this world lacks pass through untouched.
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
    readProgress: {},
    labels: {},
    pins: [],
    drawings: {},
    filedRecords: {},
    looseRecords: {},
    props: {},
    placements: {},
    spawnedBoxes: {},
    removedBoxes: [],

    loaded: false,
    scanning: false,
    progress: null,
    scanStarted: null,
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
     * A crate has no order worth keeping, so a record's place is one entry
     * rather than an arrangement. See `Records.tsx` for the deal.
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

    placeProp: (prop) => {
      // One cup and one headlamp, each under its own id; everything else is
      // minted on arrival, counter plus time so ids never collide.
      propCounter += 1
      const id =
        prop.kind === 'cup' || prop.kind === 'headlamp'
          ? prop.kind
          : `prop-${Date.now().toString(36)}-${propCounter}`
      set({ props: { ...get().props, [id]: prop } })
      scheduleSave()
      return id
    },

    removeProp: (id) => {
      const found = get().props[id]
      if (!found) return undefined
      set({ props: omit(get().props, id) })
      scheduleSave()
      return found
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
        const spawnedBoxes = layout?.spawnedBoxes ?? {}
        const removedBoxes = layout?.removedBoxes ?? []
        // The world must know which boxes exist and where before the books are
        // reconciled against it, or the piles are drawn at the old places.
        useWorldStore.getState().setBoxEdits({ spawned: spawnedBoxes, removed: removedBoxes })
        useWorldStore.getState().setPlacements(placements)

        set({
          books,
          byId,
          dims,
          savedRows,
          savedBoxes,
          readProgress,
          loose,
          labels: layout?.labels ?? {},
          pins,
          drawings: layout?.drawings ?? {},
          // Not filtered against the music folder: a record whose file is
          // momentarily missing should find its crate again when it returns,
          // and an entry for a track nobody has is inert.
          filedRecords: layout?.records?.filed ?? {},
          looseRecords: layout?.records?.loose ?? {},
          props: layout?.props ?? {},
          placements,
          spawnedBoxes,
          removedBoxes,
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
      if (rebuilding) return
      const { books, dims, savedRows, savedBoxes, hasSavedLayout, loaded, loose } = get()
      if (!loaded) return
      let world = currentWorld()
      // Nothing to stand books on yet. `load` runs after the world in practice,
      // and the world store's subscription calls back here if it does not.
      if (!world) return

      rebuilding = true
      try {
        const saved = hasSavedLayout ? { rows: savedRows, boxes: savedBoxes, loose } : null
        const folderOf = useSettings.getState().boxPerFolder
          ? (id: string) => bookFolder(get().byId.get(id)?.path ?? '')
          : undefined

        if (folderOf) {
          // A dry run to see what is arriving fresh this time, so there is a
          // box for every subject among it before packing for real. A box
          // still holding earlier books is not free — a folder put into one
          // would share it, and a shared box gets no label.
          const ids = books.map((b) => b.id)
          const probe = reconcile(world, saved, ids, (id) => dims.get(id), folderOf)
          const freshSet = new Set(probe.fresh)
          const folders = new Set(probe.fresh.map(folderOf)).size
          const free = boxesIn(world).filter(
            (box) => !(probe.boxes[box.id] ?? []).some((id) => !freshSet.has(id)),
          ).length
          world = growFolderBoxes(world, folders - free)
        }

        const result = reconcile(
          world,
          saved,
          books.map((b) => b.id),
          (id) => dims.get(id),
          // One Box per Folder: arrivals are packed a folder at a time, so the
          // boxes come out of the van pre-sorted.
          folderOf,
        )
        set(project(world, result, dims))
        if (folderOf) applyFolderLabels(result.folderLabels)

        if (!hasSavedLayout) {
          // First run in this folder: everything is in a box, and which box is
          // written down so the piles are the same on the second launch.
          set({ savedRows: result.rows, savedBoxes: result.boxes, hasSavedLayout: true })
          scheduleSave()
        }
        // Deliberately no save: boxed books stay written down against the shelf
        // they came from, so restoring the bookcase puts them back on it.
      } finally {
        rebuilding = false
      }
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

    spawnBox: (x, z, facing, elevation) => {
      const world = currentWorld()
      if (!world || world.rooms.length === 0) return null

      // The frame the position is written in: the room you are in, or the
      // nearest one outdoors. Any room works; nearest keeps the numbers small.
      const room =
        roomAt(world, x, z, elevation) ??
        [...world.rooms].sort(
          (a, b) =>
            Math.hypot(a.origin[0] - x, a.origin[1] - z) -
            Math.hypot(b.origin[0] - x, b.origin[1] - z),
        )[0]!

      // A broken-down id stays burned, or its leftover layout entries would
      // haunt the next box to take it.
      const taken = new Set([
        ...world.furniture.map((item) => item.id),
        ...Object.keys(get().spawnedBoxes),
        ...get().removedBoxes,
      ])
      let n = 1
      while (taken.has(`box-${n}`)) n += 1
      const id = `box-${n}`

      const spawnedBoxes: Record<string, SpawnedBox> = {
        ...get().spawnedBoxes,
        [id]: {
          room: room.id,
          at: [x - room.origin[0], z - room.origin[1]],
          facing,
          elevation,
        },
      }
      set({ spawnedBoxes })
      useWorldStore.getState().setBoxEdits({ spawned: spawnedBoxes, removed: get().removedBoxes })
      scheduleSave()
      return id
    },

    deleteBox: (boxId) => {
      const world = currentWorld()
      if (!world || !boxesIn(world).some((box) => box.id === boxId)) return false
      // Only an empty box breaks down. Books do not vanish with the cardboard.
      if ((get().boxes[boxId]?.length ?? 0) > 0) return false

      const spawnedBoxes = { ...get().spawnedBoxes }
      delete spawnedBoxes[boxId]
      // Document boxes go on the broken-down list; a spawned one goes there
      // too, which burns its id — see `spawnBox`.
      const removedBoxes = [...get().removedBoxes, boxId]

      // Its shove and any stale box entry go with it.
      const placements = { ...get().placements }
      delete placements[boxId]
      const savedBoxes = { ...get().savedBoxes }
      delete savedBoxes[boxId]

      set({ spawnedBoxes, removedBoxes, placements, savedBoxes })
      const worldStore = useWorldStore.getState()
      if (boxId in worldStore.placements) worldStore.setPlacements(placements)
      worldStore.setBoxEdits({ spawned: spawnedBoxes, removed: removedBoxes })
      scheduleSave()
      return true
    },

    scan: async () => {
      if (get().scanning) return
      set({ scanning: true, progress: null, scanStarted: performance.now(), error: null })
      const stop = library.onScanProgress((progress) => set({ progress }))
      try {
        const lastScan = await library.scan()
        set({ lastScan })
        // "Scan" means look at the whole folder again. The media folders need
        // nothing in Rust, but their lists were read once at startup — so
        // without this a record dropped in mid-session waits for a relaunch.
        await Promise.all([
          get().load(),
          useMediaStore.getState().load(),
          useVideoStore.getState().load(),
          useArcadeStore.getState().load(),
        ])
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) })
      } finally {
        stop()
        set({ scanning: false, progress: null, scanStarted: null })
      }
    },

    unshelve: (id) => {
      const { rows, boxes, dims, boxed, loose } = get()
      const world = currentWorld()
      const one = new Set([id])

      // A book taken out of a box has to leave it, or you could take the same
      // book forever. Off a table counts too.
      const onShelf = Object.values(rows).some((ids) => ids.includes(id))
      if (!onShelf && !boxed.includes(id) && !(id in loose)) return false

      const next = without(rows, one)
      const nextBoxes = without(boxes, one)

      set({
        ...remember(id, null),
        rows: next,
        packed: world ? packLayout(world, next, (x) => dims.get(x), leaning()) : [],
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
        packed: world ? packLayout(world, next, (x) => dims.get(x), leaning()) : [],
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
        packed: world ? packLayout(world, next, (x) => dims.get(x), leaning()) : [],
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
        packed: world ? packLayout(world, next, (x) => dims.get(x), leaning()) : [],
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

    /** Empty rows in the nearest case first, so carrying a box to a case fills that one. */
    emptyBoxOntoShelves: (boxId) => {
      const { rows, boxes, dims, savedBoxes } = get()
      const world = currentWorld()
      const ids = boxes[boxId] ?? []
      if (!world || ids.length === 0) return 0

      const lookup = (id: string) => dims.get(id)
      const box = boxesIn(world).find((item) => item.id === boxId)
      const order = box
        ? nearestRowsFirst(world, rows, box)
        : emptyRowsFirst(world, rows, mulberry32(hashId(boxId)))
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
        packed: packLayout(world, arranged.rows, lookup, leaning()),
        boxes: nextBoxes,
        boxed: flatten(world, nextBoxes),
      })
      scheduleSave()
      return moved.size
    },

    /** Runs a new library's own reconciliation, so the result matches a fresh folder. */
    packEverything: () => {
      if (rebuilding) return 0
      const { books, dims } = get()
      let world = currentWorld()
      if (!world) return 0
      const before = Object.values(get().rows).flat().length + Object.keys(get().loose).length

      rebuilding = true
      try {
        // The same folder-per-box rule a scan follows, so clearing the shelves
        // with the option on repacks the library sorted rather than levelled.
        const folderOf = useSettings.getState().boxPerFolder
          ? (id: string) => bookFolder(get().byId.get(id)?.path ?? '')
          : undefined

        if (folderOf) {
          // The repack empties every box, so all of them are free.
          const folders = new Set(books.map((b) => folderOf(b.id))).size
          world = growFolderBoxes(world, folders - boxesIn(world).length)
        }

        const result = reconcile(
          world,
          { rows: {}, boxes: {} },
          books.map((b) => b.id),
          (id) => dims.get(id),
          folderOf,
        )

        set({
          ...project(world, result, dims),
          savedRows: {},
          savedBoxes: result.boxes,
          loose: {},
          // Reconciliation would report "everything is new", which reads as an
          // alarm rather than as the thing that was just asked for.
          reconciliation: null,
        })
        if (folderOf) applyFolderLabels(result.folderLabels, true)
        scheduleSave()
        return before
      } finally {
        rebuilding = false
      }
    },

    packLooseBooks: () => {
      const { loose, boxes, savedRows, savedBoxes } = get()
      const world = currentWorld()
      if (!world) return 0
      const crates = boxesIn(world)
      if (crates.length === 0) return 0

      // A book on a table was left there; one supported only by the floor is a
      // stray. The physics settled each before storing, so the height is sound.
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
  return packRow(
    shelf,
    shelfIndex,
    row,
    rows[rowKey(shelf.id, row)] ?? [],
    (id) => dims.get(id),
    leaning(),
  )
}

// Re-reconcile whenever a new world document is applied. At module scope, so
// the books follow the room even if nothing is rendering them.
useWorldStore.subscribe((state, previous) => {
  if (state.revision !== previous.revision) useLibraryStore.getState().rebuild()
})

// Closing the window inside the debounce must not lose the last shelving.
// `pagehide` is the reliable signal, `beforeunload` belt and braces for the
// WebView. Fire-and-forget, but the IPC message is away before teardown.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushLayoutSave())
  window.addEventListener('beforeunload', () => void flushLayoutSave())
}
