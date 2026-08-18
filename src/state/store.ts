import { create } from 'zustand'
import { library } from '../services'
import { MARKER_INKS } from '../data/inks'
import type { DriverKind, PropKind } from '../services/types'
import { startDelivery } from './courier'
// The library store, for a book that has just arrived: it does not import this
// one, so the dependency runs one way and there is no cycle.
import { useLibraryStore } from './library'
import { useWorldStore } from './world'
import { arcadeMachine } from './arcade'
import { player } from './player'

/** On your feet, docked to an open book, or at the arcade machine's controls. */
export type Mode = 'walk' | 'read' | 'play'

/**
 * Where a held book would go if placed now: an index into `world.shelves` for
 * the renderer, and a shelf id for the layout. The index dies with the document.
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

/** What a crate is showing and which sleeve is drawn out; the rest is riffled to. */
export type CrateView = {
  /** Index of the record currently drawn out. */
  offset: number
  /** How many sleeves are standing in the crate. */
  shown: number
  /** How many it holds altogether. */
  total: number
  /** The record at `offset`, i.e. the one E would take. */
  record: string | null
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
  /** Its own field, not a reading of `focusedSeat`: a folding chair offers both verbs. */
  focusedPortable: string | null
  /** Box under the crosshair while holding a book — one you could drop it into. */
  boxTarget: string | null
  /** Where each box's visible slice starts. Not saved: riffling is not library state. */
  boxOffsets: Record<string, number>
  /**
   * The offsets browsed through to get here. Going back cannot just subtract a
   * pileful: how many books fit on top depends on their thickness.
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
   * Book drawn out to show its cover. A key press rather than the crosshair, or
   * books swing out constantly and thin ones clip their neighbours on the way.
   */
  drawn: string | null
  pointerLocked: boolean

  /** Furniture id under the crosshair that pressing E would *operate*. */
  focusedFixture: string | null
  /** Record under the crosshair, by track id. */
  focusedRecord: string | null
  /**
   * The crate `,` and `.` riffle: the one a focused sleeve is filed in, or the
   * crate itself when no sleeve is in the way.
   */
  focusedCrate: string | null
  /** How far into each crate you have riffled; that record is drawn out face-on. */
  crateOffsets: Record<string, number>
  /** The offsets you flicked through to get here, per crate. */
  crateTrail: Record<string, number[]>
  /** What each crate holds and which of it is out, written by the renderer. */
  crateViews: Record<string, CrateView>
  /**
   * Which crate each record ended up in. Unlike `filedRecords` this covers dealt
   * records too, so it is what the catalogue answers "where is it" from.
   */
  recordCrates: Record<string, string>
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
  /** The carcass under the crosshair, book or no book, so `L` can label an empty case. */
  focusedShelf: string | null
  /** Where a held book would land on a table, in world metres, and on what. */
  surfaceTarget: SurfaceTarget | null
  /** A box, or folded furniture. Both hands, so nothing else is offered while it is up. */
  carried: string | null
  /** Shelf id whose label you are typing, or null. */
  labelling: string | null
  /**
   * A page or note in your hand. Not exclusive with `held`: `E` prefers the
   * sheet only when aimed at a wall, which is not somewhere a book can go.
   */
  heldPin: HeldSheet | null
  /** Where the sheet in your hand would land. Null when not aiming at a wall. */
  pinTarget: PinTarget | null
  /** Id of a pinned sheet under the crosshair, one you could take down. */
  focusedPin: string | null
  /**
   * The marker in your hand, by furniture id. Never persisted: a held marker is
   * the tray's marker, hidden.
   */
  heldMarker: string | null
  /** Which pen the marker is drawing in, as an index into the marker inks. */
  markerInk: number
  /** Whiteboard under the crosshair while holding the marker — one you could draw on. */
  boardTarget: string | null
  /** True while the note field is open, so movement keys stay typed. */
  noting: boolean
  /** Not a mode — you are still in the room — but it takes the keyboard like one. */
  searching: boolean
  /** True while the cat is under the crosshair, near enough to reach. */
  focusedCat: boolean
  /** Coffee maker that is currently brewing. It stops on its own. */
  brewing: string | null
  /** Coffee makers whose pot is full and waiting. Drained a cup at a time. */
  readyPots: Record<string, boolean>
  /** The cup, a can, a takeaway box. Already removed from the placed props. */
  heldProp: { kind: PropKind; full: boolean } | null
  /** Placed prop under the crosshair while empty-handed, by prop id. */
  focusedProp: string | null
  /** The headlamp on your head, by furniture id. Worn, not held: hands stay free. */
  wornLamp: string | null
  /**
   * What the telephone is asking, or null on the hook. Two steps because one of
   * the two things to order needs an id typing.
   */
  phoning: 'menu' | 'paper' | null
  /** True while a paper is being fetched, so the card can say so. */
  fetching: boolean
  /** The message, not a flag: a bad id and an unknown paper have different fixes. */
  orderError: string | null
  /** True between ordering on the telephone and the delivery turning up. */
  ordering: boolean
  /** True while the courier is somewhere on the grass. Mounts his meshes. */
  courierAbout: boolean
  /**
   * A request, not a value: the HUD types the number and the reader knows how to
   * get there, so neither needs a reference to the other. Cleared by the reader.
   */
  jumpTo: number | null
  /** True while the "go to page" field is open, so movement keys stay typed. */
  jumping: boolean
  /** Not `noting`: that is a note for a wall, this one is on the page you are reading. */
  annotating: boolean
  /** For screenshots. The label and page fields ignore it: they are conversations, not chrome. */
  hudHidden: boolean
  /** True while the controls card is open. */
  controlsOpen: boolean
  /** True while the settings panel is open. Settings are not HUD. */
  settingsOpen: boolean
  /** False until you have gone in. The room loads behind the menu; keys do not reach it. */
  started: boolean
  /** What just happened, briefly. One at a time, last write wins, dropped at `until`. */
  notice: { text: string; until: number } | null

  setMode: (mode: Mode) => void
  setSeat: (id: string | null) => void
  setDrawn: (id: string | null) => void
  setFocusedBook: (id: string | null) => void
  setShelfTarget: (target: ShelfTarget | null) => void
  setFocusedSeat: (id: string | null) => void
  setFocusedBox: (id: string | null) => void
  setFocusedPortable: (id: string | null) => void
  setBoxTarget: (id: string | null) => void
  setBoxViews: (views: Record<string, { offset: number; shown: number; total: number }>) => void
  /** Riffle through a box: `+1` deeper into it, `-1` back towards the top. */
  browseBox: (boxId: string, direction: 1 | -1) => void
  setHeld: (id: string | null) => void
  setReading: (id: string | null) => void
  setPointerLocked: (locked: boolean) => void
  setFocusedFixture: (id: string | null) => void
  setFocusedRecord: (id: string | null) => void
  setFocusedCrate: (id: string | null) => void
  /** Publish the deal: what each crate is showing, and where every record went. */
  setCrateDeal: (views: Record<string, CrateView>, crates: Record<string, string>) => void
  /** Riffle through a crate: `+1` deeper into it, `-1` back towards the front. */
  browseCrate: (crateId: string, direction: 1 | -1) => void
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
  setCarried: (id: string | null) => void
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
  setPhoning: (state: 'menu' | 'paper' | null) => void
  order: () => void
  /** Resolves once fetched or refused, because the card is waiting to say which. */
  orderPaper: (id: string) => Promise<void>
  setCourierAbout: (about: boolean) => void
  /** Coffee is the one with an effect — see `player.boostUntil`. An empty stays empty. */
  consume: () => void

  loadRoot: () => Promise<void>
  pickRoot: () => Promise<void>
}

/** A sheet before it is stuck to anything. No position yet: that is `PinnedSheet`. */
export type HeldSheet =
  | { kind: 'page'; bookId: string; page: number }
  | { kind: 'note'; text: string; colour: number }

/** A point on a wall or board, and its facing. No wall id: a wall has no slots. */
export type PinTarget = {
  x: number
  y: number
  z: number
  /** Radians about Y, from the surface's outward normal. */
  yaw: number
}

/**
 * Where a held book would rest on a surface. A world point rather than an index,
 * because a surface has no slots, and the layout stores that same point.
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
  focusedPortable: null,
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
  focusedCrate: null,
  crateOffsets: {},
  crateTrail: {},
  crateViews: {},
  recordCrates: {},
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
  carried: null,
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
  phoning: null,
  fetching: false,
  orderError: null,
  ordering: false,
  courierAbout: false,
  jumpTo: null,
  jumping: false,
  annotating: false,
  notice: null,

  /**
   * Read mode with no book is a dead end: nothing renders and the walk stops.
   * Play mode at an empty machine is refused for the same reason.
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
  setFocusedPortable: (focusedPortable) => {
    if (get().focusedPortable !== focusedPortable) set({ focusedPortable })
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
  setFocusedCrate: (focusedCrate) => {
    if (get().focusedCrate !== focusedCrate) set({ focusedCrate })
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
  setCarried: (carried) => set({ carried }),
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

  setPhoning: (phoning) => set({ phoning, orderError: null }),

  order: () => {
    if (get().ordering) return
    set({ ordering: true, phoning: null, orderError: null })
    // The box lands when the courier reaches the steps (see `Courier.tsx`), not
    // on a timer, so `ordering` stays true until it has been put down.
    setTimeout(() => {
      if (!get().ordering) return
      const world = useWorldStore.getState().world
      if (!world) {
        // No world to walk through, so the order fails rather than placing a
        // box nowhere.
        set({ ordering: false })
        return
      }
      startDelivery(world, { kind: 'takeaway' })
      set({ courierAbout: true })
    }, PREP_MS)
  },

  orderPaper: async (id) => {
    if (get().ordering || get().fetching) return
    set({ fetching: true, orderError: null })
    try {
      // Downloaded before the courier sets off, so a missing paper is an error
      // on the telephone rather than a delivery of nothing.
      const book = await library.fetchPaper(id)
      // Reconciled into a box the ordinary way; the courier takes it back out
      // on arrival. No second path for a book that came in through the door.
      await useLibraryStore.getState().load()
      const world = useWorldStore.getState().world
      if (!world) {
        set({ fetching: false, phoning: null })
        return
      }
      set({ fetching: false, phoning: null, ordering: true })
      startDelivery(world, { kind: 'book', id: book.id, title: book.title })
      set({ courierAbout: true })
    } catch (e) {
      set({ fetching: false, orderError: e instanceof Error ? e.message : String(e) })
    }
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

  /** Move by a pileful, stopping at the ends rather than wrapping, which reads as a reset. */
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

  setCrateDeal: (crateViews, recordCrates) => {
    // Written on every deal or riffle, so it guards no-op publishes like
    // `setBoxViews`. The deal compares by identity — the renderer memoises it.
    const current = get().crateViews
    const keys = Object.keys(crateViews)
    const same =
      recordCrates === get().recordCrates &&
      keys.length === Object.keys(current).length &&
      keys.every((key) => {
        const a = current[key]
        const b = crateViews[key]!
        return (
          a &&
          a.offset === b.offset &&
          a.shown === b.shown &&
          a.total === b.total &&
          a.record === b.record
        )
      })
    if (!same) set({ crateViews, recordCrates })
  },

  /** One record deeper; the crate shows whichever crateful that record is in. */
  browseCrate: (crateId, direction) => {
    const view = get().crateViews[crateId]
    if (!view || view.total === 0) return
    const trail = get().crateTrail[crateId] ?? []

    let next: number
    let nextTrail: number[]
    if (direction > 0) {
      next = view.offset + 1
      // Nothing behind the last sleeve: stay on it.
      if (next >= view.total) return
      nextTrail = [...trail, view.offset]
    } else {
      next = trail.length ? trail[trail.length - 1]! : 0
      if (next === view.offset) return
      nextTrail = trail.slice(0, -1)
    }

    set({
      crateOffsets: { ...get().crateOffsets, [crateId]: next },
      crateTrail: { ...get().crateTrail, [crateId]: nextTrail },
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
 * Whether a keystroke is meant for the room, asked by every key handler. Labels,
 * notes, the search, the settings panel and the menu all take the keyboard —
 * add any new typed field here.
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
    !state.searching &&
    state.phoning === null
  )
}
