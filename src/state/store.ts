import { create } from 'zustand'
import { library } from '../services'

/**
 * Where you are: on your feet in the room, or docked to an open book.
 *
 * Not a setting. There used to be a row of mode buttons including an "edit"
 * camera that edited nothing and a "read" that froze you with no book to look
 * at; you never pick a mode now. You walk, and opening a book puts you in it
 * until you close it.
 */
export type Mode = 'walk' | 'read'

/**
 * Where a held book would go if you placed it now.
 *
 * Carries both the index into `world.shelves` (for the renderer) and the shelf's
 * id (for the layout), because the index is only meaningful for as long as the
 * current world document is the live one.
 */
export type ShelfTarget = {
  shelf: number
  shelfId: string
  row: number
  index: number
  localX: number
}

type AppState = {
  mode: Mode
  libraryRoot: string | null
  rootLoaded: boolean
  driver: 'tauri' | 'browser'

  /** Book id under the crosshair while empty-handed. */
  focusedBook: string | null
  /** Shelf position under the crosshair while holding a book. */
  shelfTarget: ShelfTarget | null
  /** Furniture id under the crosshair that you could sit in. */
  focusedSeat: string | null
  /** Box under the crosshair while empty-handed — one you could unpack or browse. */
  focusedBox: string | null
  /** Box under the crosshair while holding a book — one you could drop it into. */
  boxTarget: string | null
  /**
   * How far into each box you have browsed.
   *
   * A box holds far more than it can show, so the pile on top is a slice of it
   * and this is where that slice starts. Deliberately session state rather than
   * something saved: where you have riffled to is not part of the library.
   */
  boxOffsets: Record<string, number>
  /**
   * The offsets you browsed through to get here, per box.
   *
   * Going back cannot simply subtract a pileful: how many books fit on top of a
   * box depends on how thick they happen to be, so the way back to the pile you
   * were just looking at is to remember where it started.
   */
  boxTrail: Record<string, number[]>
  /** What each box is currently showing, written by the renderer that packs it. */
  boxViews: Record<string, { offset: number; shown: number; total: number }>
  /** Book id in hand. */
  held: string | null
  /** Book id being read. */
  reading: string | null
  /** Furniture id currently sat in, or null when standing. */
  seat: string | null
  /**
   * Book id currently drawn out of the shelf to show its cover.
   *
   * Deliberately a deliberate act. Turning a book automatically whenever the
   * crosshair crossed it meant books swinging out constantly, and a thin one
   * would clip its neighbours on the way.
   */
  drawn: string | null
  pointerLocked: boolean

  /** Furniture id under the crosshair that pressing E would *operate*. */
  focusedFixture: string | null
  /** Record under the crosshair, by track id. */
  focusedRecord: string | null
  /** Record in hand, by track id. Separate from `held`: a sleeve is not a book. */
  heldRecord: string | null
  /** Record crate under the crosshair while holding a record — file it back. */
  crateTarget: string | null
  /**
   * Bookcase carcass under the crosshair, whether or not a book is.
   *
   * Exists for `L`: labelling an *empty* case used to be impossible, because the
   * only routes to a shelf id went through a held book or a shelved one.
   */
  focusedShelf: string | null
  /** Where a held book would land on a table, in world metres, and on what. */
  surfaceTarget: SurfaceTarget | null
  /** Moving box being carried about the room, or null. */
  carriedBox: string | null
  /** Shelf id whose label you are typing, or null. */
  labelling: string | null
  /** Coffee maker that is currently brewing. It stops on its own. */
  brewing: string | null
  /**
   * A page the reader has been asked to jump to, as a spread index.
   *
   * A request rather than a value: the HUD is where you type a page number and
   * the reader is what knows how to get there, and passing it through the store
   * keeps the two from having to hold a reference to each other. The reader
   * clears it once it has gone.
   */
  jumpTo: number | null
  /** True while the "go to page" field is open, so movement keys stay typed. */
  jumping: boolean
  /**
   * Whether the overlay is drawn at all. The room is the point; the HUD is
   * scaffolding, and being able to strike it is what makes screenshots worth
   * taking. The label and page fields ignore this — they are conversations you
   * started, not chrome.
   */
  hudHidden: boolean
  /** True while the controls card is open. */
  controlsOpen: boolean

  setMode: (mode: Mode) => void
  setSeat: (id: string | null) => void
  setDrawn: (id: string | null) => void
  setFocusedBook: (id: string | null) => void
  setShelfTarget: (target: ShelfTarget | null) => void
  setFocusedSeat: (id: string | null) => void
  setFocusedBox: (id: string | null) => void
  setBoxTarget: (id: string | null) => void
  setBoxViews: (views: Record<string, { offset: number; shown: number; total: number }>) => void
  /** Riffle through a box: `+1` deeper into it, `-1` back towards the top. */
  browseBox: (boxId: string, direction: 1 | -1) => void
  setHeld: (id: string | null) => void
  setReading: (id: string | null) => void
  setPointerLocked: (locked: boolean) => void
  setFocusedFixture: (id: string | null) => void
  setFocusedRecord: (id: string | null) => void
  setHeldRecord: (id: string | null) => void
  setCrateTarget: (id: string | null) => void
  setFocusedShelf: (id: string | null) => void
  toggleHud: () => void
  setControlsOpen: (open: boolean) => void
  setSurfaceTarget: (target: SurfaceTarget | null) => void
  setCarriedBox: (id: string | null) => void
  setLabelling: (shelfId: string | null) => void
  setJumping: (open: boolean) => void
  /** Ask the reader to open at `spread`. Cleared by the reader once it has. */
  requestJump: (spread: number | null) => void
  /** Start a brew. It runs for a while and then stops itself. */
  brew: (id: string) => void

  loadRoot: () => Promise<void>
  pickRoot: () => Promise<void>
}

/**
 * Where a held book would come to rest on a table, counter or bench.
 *
 * Unlike a shelf, a surface has no slots: you put a book down *there*, and the
 * position is what gets remembered. So the target carries a world point rather
 * than an index, and the placement written into the layout is the same point.
 */
export type SurfaceTarget = {
  furnitureId: string
  x: number
  y: number
  z: number
}

const sameSurface = (a: SurfaceTarget | null, b: SurfaceTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.furnitureId === b.furnitureId &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.z - b.z) < 0.01)

/** How long a pot takes. Long enough to walk away from and come back to. */
const BREW_MS = 12_000

const sameTarget = (a: ShelfTarget | null, b: ShelfTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.shelfId === b.shelfId &&
    a.row === b.row &&
    a.index === b.index)

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'walk',
  libraryRoot: null,
  rootLoaded: false,
  driver: library.kind,

  focusedBook: null,
  shelfTarget: null,
  focusedSeat: null,
  focusedBox: null,
  boxTarget: null,
  boxOffsets: {},
  boxTrail: {},
  boxViews: {},
  held: null,
  reading: null,
  seat: null,
  drawn: null,
  pointerLocked: false,
  focusedFixture: null,
  focusedRecord: null,
  heldRecord: null,
  crateTarget: null,
  focusedShelf: null,
  hudHidden: false,
  controlsOpen: false,
  surfaceTarget: null,
  carriedBox: null,
  labelling: null,
  brewing: null,
  jumpTo: null,
  jumping: false,

  /**
   * Read mode without a book is a dead end — nothing renders, the walk
   * controller stops, and the only way out is the mode buttons. Refuse it.
   */
  setMode: (mode) => {
    if (mode === 'read' && get().reading === null) return
    set({ mode })
  },

  setSeat: (seat) => set({ seat }),
  setDrawn: (drawn) => set({ drawn }),

  // These two run off a per-frame raycast, so they guard against no-op writes.
  setFocusedBook: (focusedBook) => {
    if (get().focusedBook !== focusedBook) set({ focusedBook })
  },
  setShelfTarget: (shelfTarget) => {
    if (!sameTarget(get().shelfTarget, shelfTarget)) set({ shelfTarget })
  },
  setFocusedSeat: (focusedSeat) => {
    if (get().focusedSeat !== focusedSeat) set({ focusedSeat })
  },
  setFocusedBox: (focusedBox) => {
    if (get().focusedBox !== focusedBox) set({ focusedBox })
  },
  setBoxTarget: (boxTarget) => {
    if (get().boxTarget !== boxTarget) set({ boxTarget })
  },
  setFocusedFixture: (focusedFixture) => {
    if (get().focusedFixture !== focusedFixture) set({ focusedFixture })
  },
  setFocusedRecord: (focusedRecord) => {
    if (get().focusedRecord !== focusedRecord) set({ focusedRecord })
  },
  setHeldRecord: (heldRecord) => set({ heldRecord }),
  setCrateTarget: (crateTarget) => {
    if (get().crateTarget !== crateTarget) set({ crateTarget })
  },
  setFocusedShelf: (focusedShelf) => {
    if (get().focusedShelf !== focusedShelf) set({ focusedShelf })
  },
  toggleHud: () => set({ hudHidden: !get().hudHidden }),
  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
  setSurfaceTarget: (surfaceTarget) => {
    if (!sameSurface(get().surfaceTarget, surfaceTarget)) set({ surfaceTarget })
  },
  setCarriedBox: (carriedBox) => set({ carriedBox }),
  setLabelling: (labelling) => set({ labelling }),
  setJumping: (jumping) => set({ jumping }),
  requestJump: (jumpTo) => set({ jumpTo, jumping: false }),

  brew: (id) => {
    if (get().brewing !== null) return
    set({ brewing: id })
    setTimeout(() => {
      if (get().brewing === id) set({ brewing: null })
    }, BREW_MS)
  },

  setBoxViews: (boxViews) => {
    // Written every time a box is repacked; a re-render for an identical view
    // would be one per frame while you stand still.
    const current = get().boxViews
    const keys = Object.keys(boxViews)
    const same =
      keys.length === Object.keys(current).length &&
      keys.every((key) => {
        const a = current[key]
        const b = boxViews[key]!
        return a && a.offset === b.offset && a.shown === b.shown && a.total === b.total
      })
    if (!same) set({ boxViews })
  },

  /**
   * A box shows the top of the pile; browsing moves the whole slice by a
   * pileful, so every book in it can be brought to the surface. Stops at the
   * ends rather than wrapping — riffling past the last book and landing back at
   * the first reads as the box having reset itself.
   */
  browseBox: (boxId, direction) => {
    const view = get().boxViews[boxId]
    if (!view || view.total === 0) return
    const trail = get().boxTrail[boxId] ?? []

    let next: number
    let nextTrail: number[]
    if (direction > 0) {
      next = view.offset + Math.max(1, view.shown)
      // Nothing under the pile: stay put rather than showing an empty box.
      if (next >= view.total) return
      nextTrail = [...trail, view.offset]
    } else {
      // Back to exactly the pile you were looking at, or to the top if this is
      // a box you have not browsed down through.
      next = trail.length ? trail[trail.length - 1]! : 0
      if (next === view.offset) return
      nextTrail = trail.slice(0, -1)
    }

    set({
      boxOffsets: { ...get().boxOffsets, [boxId]: next },
      boxTrail: { ...get().boxTrail, [boxId]: nextTrail },
    })
  },

  setHeld: (held) => set({ held }),
  setReading: (reading) => set({ reading }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),

  loadRoot: async () => {
    const libraryRoot = await library.getRoot()
    set({ libraryRoot, rootLoaded: true })
  },

  pickRoot: async () => {
    const picked = await library.pickRoot()
    if (picked) set({ libraryRoot: picked })
  },
}))
