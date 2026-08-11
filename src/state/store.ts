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
  /** Box under the crosshair while empty-handed — one you could unpack. */
  focusedBox: string | null
  /** Box under the crosshair while holding a book — one you could drop it into. */
  boxTarget: string | null
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

  setMode: (mode: Mode) => void
  setSeat: (id: string | null) => void
  setDrawn: (id: string | null) => void
  setFocusedBook: (id: string | null) => void
  setShelfTarget: (target: ShelfTarget | null) => void
  setFocusedSeat: (id: string | null) => void
  setFocusedBox: (id: string | null) => void
  setBoxTarget: (id: string | null) => void
  setHeld: (id: string | null) => void
  setReading: (id: string | null) => void
  setPointerLocked: (locked: boolean) => void

  loadRoot: () => Promise<void>
  pickRoot: () => Promise<void>
}

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
  held: null,
  reading: null,
  seat: null,
  drawn: null,
  pointerLocked: false,

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
