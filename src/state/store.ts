import { create } from 'zustand'
import { library } from '../services'
import { MARKER_INKS } from '../data/inks'
import type { DriverKind, PropKind } from '../services/types'
import { startDelivery } from './courier'
import { useWorldStore } from './world'
import { arcadeMachine } from './arcade'
import { player } from './player'

/**
 * Where you are: on your feet in the room, docked to an open book, or stood at
 * the arcade machine with your hands on its controls. Not a setting — you walk,
 * and opening a book or stepping up to the game puts you in it until you leave.
 */
export type Mode = 'walk' | 'read' | 'play'

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
  /** Whether the held book would actually go in — `shelve` refuses when false. */
  fits: boolean
}

type AppState = {
  mode: Mode
  libraryRoot: string | null
  rootLoaded: boolean
  driver: DriverKind

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
  /** Tape under the crosshair, by tape id. */
  focusedTape: string | null
  /** Tape in hand, by tape id. Its own slot: a cassette is not a book. */
  heldTape: string | null
  /** Tape crate under the crosshair while holding a tape — put it back. */
  tapeCrateTarget: string | null
  /** ROM cartridge in hand, by rom id. Its own slot: a cartridge is not a book. */
  heldRom: string | null
  /**
   * Bookcase carcass under the crosshair, whether or not a book is. This is what
   * lets `L` label an empty case.
   */
  focusedShelf: string | null
  /** Where a held book would land on a table, in world metres, and on what. */
  surfaceTarget: SurfaceTarget | null
  /** Moving box being carried about the room, or null. */
  carriedBox: string | null
  /** Shelf id whose label you are typing, or null. */
  labelling: string | null
  /**
   * A page or note in your hand.
   *
   * Deliberately *not* mutually exclusive with `held`: a sheet of paper is not a
   * book, and tearing a copy of a page out of the book you are reading would be
   * absurd if it meant putting the book down first. E prefers the sheet only
   * when you are aiming at somewhere a sheet can go, which is a wall — and a
   * wall is not somewhere a book can go, so the two never compete.
   */
  heldPin: HeldSheet | null
  /** Where the sheet in your hand would land. Null when not aiming at a wall. */
  pinTarget: PinTarget | null
  /** Id of a pinned sheet under the crosshair, one you could take down. */
  focusedPin: string | null
  /**
   * The whiteboard marker in your hand, by furniture id.
   *
   * Its own slot rather than a kind of `held`, for the same reason a record has
   * one: a marker is not a book, and the crosshair offers a different set of
   * things while you are carrying it. It never moves — a marker in your hand is
   * the marker on the tray, hidden — so there is nothing to write down.
   */
  heldMarker: string | null
  /** Which pen the marker is drawing in, as an index into the marker inks. */
  markerInk: number
  /** Whiteboard under the crosshair while holding the marker — one you could draw on. */
  boardTarget: string | null
  /** True while the note field is open, so movement keys stay typed. */
  noting: boolean
  /**
   * True while the catalogue terminal's search is open.
   *
   * Session state, and deliberately not a mode: you are still standing in the
   * office with the room behind the panel, exactly as you are while typing a
   * label. It takes the keyboard for the same reason and gives it back the same
   * way.
   */
  searching: boolean
  /** True while the cat is under the crosshair, near enough to reach. */
  focusedCat: boolean
  /** Coffee maker that is currently brewing. It stops on its own. */
  brewing: string | null
  /** Coffee makers whose pot is full and waiting. Drained a cup at a time. */
  readyPots: Record<string, boolean>
  /**
   * The small thing in your hand: the cup, a can, a takeaway box.
   *
   * Its own slot for the record's reason — a can is not a book, and the
   * crosshair offers a different set of places while you carry one. Which one
   * it is and whether it is full is all there is to know; where it came from
   * has already been taken out of the placed props.
   */
  heldProp: { kind: PropKind; full: boolean } | null
  /** Placed prop under the crosshair while empty-handed, by prop id. */
  focusedProp: string | null
  /**
   * The headlamp on your head, by furniture id. Worn, not held: the whole
   * point is walking out into the dark with both hands free for books.
   */
  wornLamp: string | null
  /** True between ordering on the telephone and the food turning up. */
  ordering: boolean
  /** True while the courier is somewhere on the grass. Mounts his meshes. */
  courierAbout: boolean
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
   * True while the book-note field is open, in read mode. Not `noting`: that
   * is a note for a wall, this is a note on the page you are reading.
   */
  annotating: boolean
  /**
   * Whether the overlay is drawn at all. The room is the point; the HUD is
   * scaffolding, and being able to strike it is what makes screenshots worth
   * taking. The label and page fields ignore this — they are conversations you
   * started, not chrome.
   */
  hudHidden: boolean
  /** True while the controls card is open. */
  controlsOpen: boolean
  /** True while the settings panel is open. Settings are not HUD. */
  settingsOpen: boolean
  /**
   * False until you have gone in from the main menu. The room loads behind it,
   * so nothing you press reaches the room until you have.
   */
  started: boolean
  /**
   * A line for the status strip: what just happened, briefly. One at a time,
   * last write wins; the strip drops it once `until` passes.
   */
  notice: { text: string; until: number } | null

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
  setFocusedTape: (id: string | null) => void
  setHeldTape: (id: string | null) => void
  setTapeCrateTarget: (id: string | null) => void
  setHeldRom: (id: string | null) => void
  setFocusedShelf: (id: string | null) => void
  toggleHud: () => void
  setControlsOpen: (open: boolean) => void
  setSurfaceTarget: (target: SurfaceTarget | null) => void
  setCarriedBox: (id: string | null) => void
  setLabelling: (shelfId: string | null) => void
  setHeldPin: (sheet: HeldSheet | null) => void
  setPinTarget: (target: PinTarget | null) => void
  setFocusedPin: (id: string | null) => void
  setHeldMarker: (id: string | null) => void
  /** Move to the next pen in the tray. Returns the ink now in the marker. */
  cycleInk: () => number
  setBoardTarget: (id: string | null) => void
  setNoting: (open: boolean) => void
  setSearching: (open: boolean) => void
  setFocusedCat: (near: boolean) => void
  setJumping: (open: boolean) => void
  setAnnotating: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  /** Leave the main menu and go in. One way: there is no menu to go back to. */
  start: () => void
  /** Say something in the status strip for a few seconds. */
  notify: (text: string) => void
  /** Ask the reader to open at `spread`. Cleared by the reader once it has. */
  requestJump: (spread: number | null) => void
  /** Start a brew. It runs for a while and then stops itself, pot full. */
  brew: (id: string) => void
  /** Pour the pot into the cup: the maker goes back to wanting a brew. */
  drainPot: (id: string) => void
  setHeldProp: (prop: { kind: PropKind; full: boolean } | null) => void
  setFocusedProp: (id: string | null) => void
  setWornLamp: (id: string | null) => void
  /** Ring for a delivery. A courier walks it to the porch steps a while later. */
  order: () => void
  setCourierAbout: (about: boolean) => void
  /**
   * Drink or eat what is in your hand. The coffee is the one with an effect —
   * see `player.boostUntil`. An empty stays an empty.
   */
  consume: () => void

  loadRoot: () => Promise<void>
  pickRoot: () => Promise<void>
}

/**
 * A sheet in your hand, before it is stuck to anything.
 *
 * It has no position yet, which is the whole difference between this and a
 * `PinnedSheet` — and the reason it is session state rather than part of the
 * layout. A page in your hand when the app closes is a page you had not decided
 * about, and losing it costs one keystroke.
 */
export type HeldSheet =
  | { kind: 'page'; bookId: string; page: number }
  | { kind: 'note'; text: string; colour: number }

/**
 * Where a sheet would go if you pinned it now: a point on a wall or a board, and
 * the way that surface faces.
 *
 * Carries no wall id. A wall is not a thing you can put something *into* the way
 * a shelf is — there are no slots, so there is nothing to identify.
 */
export type PinTarget = {
  x: number
  y: number
  z: number
  /** Radians about Y, from the surface's outward normal. */
  yaw: number
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

const samePin = (a: PinTarget | null, b: PinTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.z - b.z) < 0.01)

const sameSurface = (a: SurfaceTarget | null, b: SurfaceTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.furnitureId === b.furnitureId &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.z - b.z) < 0.01)

/** How long a pot takes. Long enough to walk away from and come back to. */
const BREW_MS = 12_000

/** How long the kitchen takes before the courier sets off with it. */
const PREP_MS = 12_000

/** What the coffee is for: quicker on your feet until it wears off. */
const COFFEE_MS = 75_000

/** How long a notice stays up in the status strip. */
const NOTICE_MS = 4_000

const sameTarget = (a: ShelfTarget | null, b: ShelfTarget | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.shelfId === b.shelfId &&
    a.row === b.row &&
    a.index === b.index &&
    a.fits === b.fits)

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
  focusedTape: null,
  heldTape: null,
  tapeCrateTarget: null,
  heldRom: null,
  focusedShelf: null,
  hudHidden: false,
  controlsOpen: false,
  settingsOpen: false,
  started: false,
  searching: false,
  focusedCat: false,
  surfaceTarget: null,
  carriedBox: null,
  labelling: null,
  heldPin: null,
  pinTarget: null,
  focusedPin: null,
  heldMarker: null,
  markerInk: 0,
  boardTarget: null,
  noting: false,
  brewing: null,
  readyPots: {},
  heldProp: null,
  focusedProp: null,
  wornLamp: null,
  ordering: false,
  courierAbout: false,
  jumpTo: null,
  jumping: false,
  annotating: false,
  notice: null,

  /**
   * Read mode without a book is a dead end — nothing renders, the walk
   * controller stops, and the only way out is the mode buttons. Refuse it, and
   * refuse play mode at a machine with nothing in it for the same reason.
   */
  setMode: (mode) => {
    if (mode === 'read' && get().reading === null) return
    if (mode === 'play' && arcadeMachine() === null) return
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
  setFocusedTape: (focusedTape) => {
    if (get().focusedTape !== focusedTape) set({ focusedTape })
  },
  setHeldTape: (heldTape) => set({ heldTape }),
  setHeldRom: (heldRom) => set({ heldRom }),
  setTapeCrateTarget: (tapeCrateTarget) => {
    if (get().tapeCrateTarget !== tapeCrateTarget) set({ tapeCrateTarget })
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
  setHeldPin: (heldPin) => set({ heldPin }),
  // Written off the per-frame raycast, so it guards against no-op writes for
  // the same reason the shelf target does.
  setPinTarget: (pinTarget) => {
    if (!samePin(get().pinTarget, pinTarget)) set({ pinTarget })
  },
  setFocusedPin: (focusedPin) => {
    if (get().focusedPin !== focusedPin) set({ focusedPin })
  },
  setHeldMarker: (heldMarker) => set({ heldMarker }),
  cycleInk: () => {
    const markerInk = (get().markerInk + 1) % MARKER_INKS.length
    set({ markerInk })
    return markerInk
  },
  // Written off the per-frame raycast, so it guards against no-op writes.
  setBoardTarget: (boardTarget) => {
    if (get().boardTarget !== boardTarget) set({ boardTarget })
  },
  setNoting: (noting) => set({ noting }),
  setSearching: (searching) => set({ searching }),
  // Written off the per-frame raycast, so it guards against no-op writes.
  setFocusedCat: (focusedCat) => {
    if (get().focusedCat !== focusedCat) set({ focusedCat })
  },
  setJumping: (jumping) => set({ jumping }),
  setAnnotating: (annotating) => set({ annotating }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  start: () => set({ started: true, settingsOpen: false }),
  requestJump: (jumpTo) => set({ jumpTo, jumping: false }),
  notify: (text) => set({ notice: { text, until: performance.now() + NOTICE_MS } }),

  brew: (id) => {
    if (get().brewing !== null) return
    set({ brewing: id })
    setTimeout(() => {
      if (get().brewing === id) {
        set({ brewing: null, readyPots: { ...get().readyPots, [id]: true } })
      }
    }, BREW_MS)
  },

  drainPot: (id) => set({ readyPots: { ...get().readyPots, [id]: false } }),

  setHeldProp: (heldProp) => set({ heldProp }),
  // Written off the per-frame raycast, so it guards against no-op writes.
  setFocusedProp: (focusedProp) => {
    if (get().focusedProp !== focusedProp) set({ focusedProp })
  },
  setWornLamp: (wornLamp) => set({ wornLamp }),

  order: () => {
    if (get().ordering) return
    set({ ordering: true })
    // The kitchen takes its time; then somebody walks it over. The box lands
    // when the courier reaches the steps — see `Courier.tsx` — not on a timer,
    // so `ordering` stays true until he has actually put it down.
    setTimeout(() => {
      if (!get().ordering) return
      const world = useWorldStore.getState().world
      if (!world) {
        // Nowhere to walk through: the order quietly fails rather than
        // conjuring a box into a world that is not there.
        set({ ordering: false })
        return
      }
      startDelivery(world)
      set({ courierAbout: true })
    }, PREP_MS)
  },

  setCourierAbout: (courierAbout) => set({ courierAbout }),

  consume: () => {
    const prop = get().heldProp
    if (!prop || !prop.full) return
    if (prop.kind === 'cup') player.boostUntil = performance.now() + COFFEE_MS
    set({ heldProp: { kind: prop.kind, full: false } })
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

/**
 * Whether a keystroke is meant for the room. One list, because every key handler
 * needs the same answer: a shelf label, a note, the catalogue search, the
 * settings panel and the main menu all take the keyboard away from it.
 */
export function roomHasKeyboard(): boolean {
  const state = useAppStore.getState()
  return (
    state.started &&
    !state.settingsOpen &&
    state.labelling === null &&
    !state.noting &&
    !state.annotating &&
    !state.jumping &&
    !state.searching
  )
}
