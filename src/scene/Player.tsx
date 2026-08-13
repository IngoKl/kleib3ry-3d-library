import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { groundAt, stepPlayer } from './walk'
import { askCatForBook, callCat, petCat } from './Cat'
import { floorAt } from '../world/derive'
import { shelfColliders } from '../world/shelf'
import { EYE_HEIGHT, KNEEL_HEIGHT, PLAYER_RADIUS, SEATED_EYE, player } from '../state/player'
import { roomHasKeyboard, useAppStore } from '../state/store'
import { NEW_BOX, useLibraryStore } from '../state/library'
import { useAmbienceStore } from '../state/ambience'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useArcadeStore } from '../state/arcade'
import { useWorldStore } from '../state/world'
import { useSettings } from '../state/settings'
import { approach } from '../lib/ease'
import { LAMPS } from '../world/derive'
import { SLEEVE_THICKNESS } from './recordAtlas'

const WALK_FOV = 72
/** Zoomed: about 2.8x, enough to read a spine across the great room. Held, not toggled. */
const ZOOM_FOV = 26
const ZOOM_KEYS = new Set(['KeyZ'])
/** How fast the view closes in and opens back out, in units of zoom a second. */
const ZOOM_RATE = 5.5

const WALK = 1.6
const RUN = 3.0
/** Kneeling is a shuffle, not a walk. */
const KNEEL_SPEED = 0.7
/** What the coffee does: a quarter quicker, until `player.boostUntil` passes. */
const COFFEE_BOOST = 1.25
/** How fast you go down and come back up, in units of crouch per second. */
const CROUCH_RATE = 4.5

const KNEEL_KEYS = new Set(['ControlLeft', 'ControlRight', 'KeyC'])

/** How quickly velocity reaches the target. Low enough to feel like a body. */
const ACCELERATION = 12
/** …and how quickly it comes back down. Quicker: a slow stop reads as ice. */
const BRAKING = 20
const MOUSE = 0.0022
const PITCH_LIMIT = Math.PI / 2 - 0.08

/**
 * Three guards against the spurious mouse deltas pointer lock delivers after a
 * lock, a focus change or an alt-tab: a settling window in which nothing is
 * believed, a hard pixel ceiling, and a ceiling relative to how fast the hand
 * has actually been moving. Each catches what the others cannot.
 */
const MAX_STEP_PX = 400
const SETTLE_MS = 180
/** How many times the recent average a single event may be before it is a spike. */
const SPIKE_RATIO = 8
/** …but never below this, or ordinary acceleration off a standstill reads as one. */
const SPIKE_FLOOR = 120

/** How fast the camera eases back to your own eyes after a book closes. */
const HANDOFF_SECONDS = 0.32
const HANDOFF_RATE = 9

const FORWARD_KEYS = new Set(['KeyW', 'ArrowUp'])
const BACK_KEYS = new Set(['KeyS', 'ArrowDown'])
const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft'])
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight'])

export function Player() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const mode = useAppStore((s) => s.mode)
  const setPointerLocked = useAppStore((s) => s.setPointerLocked)

  const world = useWorldStore((s) => s.world)
  // Walls and furniture come pre-derived; the bookcases are added here because
  // their footprint belongs to the carcass rather than to the document. Each
  // carries the height band it occupies, so the loft's balustrade is not a wall
  // in the middle of the living room below it.
  const solids = useMemo(
    () => (world ? [...world.solids, ...shelfColliders(world.shelves)] : []),
    [world],
  )
  const keys = useRef(new Set<string>())
  const velocity = useRef({ x: 0, z: 0 })
  /** Bob phase, advanced by distance, and how much of it is applied. */
  const bob = useRef(0)
  const bobWeight = useRef(0)
  /** `performance.now()` before which no mouse delta is believed. See MAX_STEP_PX. */
  const settleUntil = useRef(0)
  /** Running average of how far the hand actually moves per event, in pixels. */
  const handSpeed = useRef(0)
  /** Seconds left of easing the camera back off a closed book. */
  const handoff = useRef(0)
  /** The right button, which zooms the same as `Z` — whichever hand is free. */
  const rightDown = useRef(false)
  /**
   * How much to scale a mouse delta by, written by the frame loop. The ratio of
   * the tangents, so a movement of the hand covers the same distance *on screen*
   * at any zoom.
   */
  const turnScale = useRef(1)

  // --- input -----------------------------------------------------------
  useEffect(() => {
    const canvas = gl.domElement

    /**
     * Empty-handed, E takes the book under the crosshair. Holding one, E puts
     * it wherever you are aiming — a shelf, or back into a box — which is how
     * you rearrange the library.
     */
    const takeOrPlace = () => {
      const state = useAppStore.getState()
      const {
        held,
        heldRecord,
        focusedBook,
        focusedSeat,
        focusedFixture,
        focusedRecord,
        focusedTape,
        heldTape,
        tapeCrateTarget,
        heldPin,
        pinTarget,
        focusedPin,
        setHeldPin,
        shelfTarget,
        boxTarget,
        crateTarget,
        surfaceTarget,
        seat,
        setHeld,
        setHeldRecord,
        setHeldTape,
        setSeat,
      } = state
      const shelf = useLibraryStore.getState()

      // A sheet goes on the wall you are aiming at. First, because a wall is
      // not somewhere anything else can go — `pinTarget` is only set when
      // pinning is the only thing E could mean. The tilt comes from the
      // position, so a board of pages is not a spreadsheet.
      if (heldPin !== null) {
        if (!pinTarget) return
        const tilt = (Math.sin(pinTarget.x * 12.9898 + pinTarget.y * 78.233) % 1) * 0.09
        shelf.pinUp({
          ...(heldPin.kind === 'page'
            ? { kind: 'page' as const, bookId: heldPin.bookId, page: heldPin.page }
            : { kind: 'note' as const, text: heldPin.text, colour: heldPin.colour }),
          x: pinTarget.x,
          y: pinTarget.y,
          z: pinTarget.z,
          yaw: pinTarget.yaw,
          tilt,
        })
        setHeldPin(null)
        return
      }

      // Taking one down puts it back in your hand, which is where it was before
      // you stuck it up — so moving a page from a wall to the board is E, E.
      if (focusedPin !== null) {
        const taken = shelf.unpin(focusedPin)
        if (taken) {
          setHeldPin(
            taken.kind === 'page'
              ? { kind: 'page', bookId: taken.bookId ?? '', page: taken.page ?? 1 }
              : { kind: 'note', text: taken.text ?? '', colour: taken.colour ?? 0 },
          )
        }
        return
      }

      // Sitting down and getting up are both E, which is the same key you use
      // for everything else you do with your hands — and a chair takes you with
      // a book in hand, because sitting down to read is what it is for.
      if (seat !== null) {
        setSeat(null)
        return
      }
      if (focusedSeat !== null) {
        setSeat(focusedSeat)
        return
      }

      // The marker goes back on its tray. There is nowhere else for it to be —
      // it never left the office, it was only in your hand.
      if (state.heldMarker !== null) {
        state.setHeldMarker(null)
        return
      }

      // Holding a record: the deck plays it, a crate files it, a table takes it
      // lying down. Filing it into the crate you are looking at is what makes a
      // record something you can arrange rather than only something you play.
      if (heldRecord !== null) {
        if (focusedFixture) {
          useMediaStore.getState().play(heldRecord, focusedFixture)
          shelf.freeRecord(heldRecord)
          setHeldRecord(null)
          return
        }
        if (crateTarget) {
          shelf.fileRecord(heldRecord, crateTarget)
          setHeldRecord(null)
          return
        }
        if (surfaceTarget) {
          shelf.putRecordDown(heldRecord, {
            x: surfaceTarget.x,
            y: surfaceTarget.y + SLEEVE_THICKNESS / 2 + 0.002,
            z: surfaceTarget.z,
            // Your own yaw, so the sleeve reads the right way up from where you
            // are standing — the same arithmetic as a book laid on a table.
            yaw: player.yaw,
          })
          setHeldRecord(null)
          return
        }
        return
      }

      // Holding a tape: the television takes it, the crate takes it back. Its
      // place in the crate comes from the folder, so putting it back is just
      // letting go of it — exactly like filing a record.
      if (heldTape !== null) {
        if (focusedFixture) {
          useVideoStore.getState().play(heldTape)
          setHeldTape(null)
          return
        }
        if (tapeCrateTarget) setHeldTape(null)
        return
      }

      // Holding a cartridge: the machine takes it and boots it; the box takes
      // it back — or, held over the box, E swaps it for the next one, which is
      // how you flick through a crate with one hand.
      if (state.heldRom !== null) {
        if (focusedFixture) {
          const piece = useWorldStore
            .getState()
            .world?.furniture.find((item) => item.id === focusedFixture)
          if (piece?.kind === 'arcade') {
            void useArcadeStore.getState().insert(state.heldRom)
            state.setHeldRom(null)
            return
          }
          if (piece?.kind === 'rombox') {
            const roms = useArcadeStore.getState().roms
            const at = roms.findIndex((rom) => rom.id === state.heldRom)
            const next = roms[(at + 1) % Math.max(1, roms.length)]
            // The only cartridge there is goes back in rather than round again.
            state.setHeldRom(next && next.id !== state.heldRom ? next.id : null)
          }
        }
        return
      }

      // Holding a cup, a can or a takeaway box: a table takes it standing, the
      // bin takes the rubbish, and the coffee maker refills its own cup.
      if (state.heldProp !== null) {
        const prop = state.heldProp
        if (focusedFixture) {
          const piece = useWorldStore
            .getState()
            .world?.furniture.find((item) => item.id === focusedFixture)
          if (piece?.kind === 'bin') {
            // Cans and cartons, full or not. Not the crockery — the cup's
            // place is by its machine, and the HUD says so.
            if (prop.kind !== 'cup') state.setHeldProp(null)
            return
          }
          if (piece?.kind === 'coffeemaker' && prop.kind === 'cup' && !prop.full) {
            if (state.readyPots[piece.id]) {
              state.drainPot(piece.id)
              state.setHeldProp({ kind: 'cup', full: true })
            }
            return
          }
          return
        }
        if (surfaceTarget) {
          useLibraryStore.getState().placeProp({
            kind: prop.kind,
            full: prop.full,
            x: surfaceTarget.x,
            y: surfaceTarget.y + 0.002,
            z: surfaceTarget.z,
            yaw: player.yaw,
          })
          state.setHeldProp(null)
        }
        return
      }

      if (held === null) {
        // A fuss. Before everything else in this branch because the crosshair
        // only ever offers the cat when it is offering nothing else.
        if (state.focusedCat) {
          petCat()
          return
        }
        // A cup, can or box standing in the room, back into your hand — and
        // the headlamp straight onto your head, because it is worn, not carried.
        if (state.focusedProp) {
          const taken = useLibraryStore.getState().removeProp(state.focusedProp)
          if (taken) {
            if (taken.kind === 'headlamp') state.setWornLamp('headlamp')
            else state.setHeldProp({ kind: taken.kind, full: taken.full })
          }
          return
        }
        // Taking a record out of the crate is the same gesture as taking a book
        // down, and it is offered only when no book is nearer — see `Interaction`.
        if (focusedRecord) {
          setHeldRecord(focusedRecord)
          return
        }
        if (focusedTape) {
          setHeldTape(focusedTape)
          return
        }
        if (focusedFixture) {
          operate(focusedFixture)
          return
        }
        // Wearing the headlamp, E on a bare tabletop sets it down there — the
        // crosshair only offers a surface, empty-handed, for exactly this.
        if (state.wornLamp !== null && surfaceTarget) {
          useLibraryStore.getState().placeProp({
            kind: 'headlamp',
            full: false,
            x: surfaceTarget.x,
            y: surfaceTarget.y + 0.002,
            z: surfaceTarget.z,
            yaw: player.yaw,
          })
          state.setWornLamp(null)
          return
        }
        if (!focusedBook) return
        state.setDrawn(null)
        shelf.unshelve(focusedBook)
        setHeld(focusedBook)
        return
      }

      // Into a box, which is how you sort books between them — and the way
      // back for a book you have decided against.
      if (boxTarget) {
        if (shelf.putInBox(held, boxTarget)) setHeld(null)
        return
      }

      // Onto a table, exactly where you are pointing. Closed: leaving one open
      // is `O`, because which of the two you meant is not something a crosshair
      // can tell you.
      if (surfaceTarget) {
        const size = shelf.dims.get(held)
        shelf.putDown(held, {
          x: surfaceTarget.x,
          y: surfaceTarget.y + (size?.thickness ?? 0.03) / 2,
          z: surfaceTarget.z,
          // Your yaw, so the cover reads the right way up from where you are
          // standing — the same arithmetic as a book put down open. See the
          // note in `Handling`.
          yaw: player.yaw,
          open: false,
          spread: 0,
        })
        setHeld(null)
        return
      }

      // Refuse rather than silently drop the book if the row is full.
      if (!shelfTarget) return
      if (shelf.shelve(held, shelfTarget.shelfId, shelfTarget.row, shelfTarget.index)) {
        setHeld(null)
      }
    }

    /** Working something: E on the thing itself rather than a switch on a wall. */
    const operate = (id: string) => {
      const world = useWorldStore.getState().world
      const item = world?.furniture.find((piece) => piece.id === id)
      if (!item) return

      if (LAMPS.has(item.kind)) {
        useAmbienceStore.getState().toggle(id, item.on ?? true)
        return
      }
      // The switch by the door: every light in the library, on or off together.
      // Off when anything is lit, so one press always darkens the house.
      if (item.kind === 'lightswitch' && world) {
        const lights = useAmbienceStore.getState()
        const anyOn = world.lights.some((lamp) => lights.isOn(lamp.id, lamp.defaultOn))
        lights.setAll(
          world.lights.map((lamp) => lamp.id),
          !anyOn,
        )
        return
      }
      if (item.kind === 'recordplayer') {
        const music = useMediaStore.getState()
        // Only the deck with the record on it answers. An empty one does not
        // help itself to the first record in the folder — a record is a thing
        // there is one of, and carrying it here is the whole gesture. Same rule
        // the television follows.
        if (music.playing && music.deck === id) music.play(music.playing, id)
        return
      }
      // The marker comes off the tray and into your hand. Nothing is written
      // down: it is the same marker, hidden while you carry it.
      if (item.kind === 'marker') {
        useAppStore.getState().setHeldMarker(id)
        return
      }
      // A flat box comes off the stack, made up and into your arms — it turns
      // into real furniture when you set it down (X), like any carried box.
      // The stack never runs out: cardboard is not the scarce thing here.
      if (item.kind === 'boxstack') {
        useAppStore.getState().setCarriedBox(NEW_BOX)
        return
      }
      if (item.kind === 'crt') {
        const video = useVideoStore.getState()
        // A television with a tape in it pauses and resumes; an empty one has
        // nothing to show, and deliberately does *not* help itself to the first
        // tape in the crate. Putting a tape in is a thing you do with your hands.
        if (video.playing) video.play(video.playing)
        return
      }
      // The cabinet: with a game in it, E steps you up to the controls and the
      // keyboard becomes the keypad — Esc steps you back. An empty machine
      // deliberately does not help itself to a cartridge, the television's rule.
      if (item.kind === 'arcade') {
        if (useArcadeStore.getState().inserted) useAppStore.getState().setMode('play')
        return
      }
      // The ROM box: the first cartridge into your hand. E on the box again,
      // cartridge in hand, swaps it for the next — see `takeOrPlace`.
      if (item.kind === 'rombox') {
        const first = useArcadeStore.getState().roms[0]
        if (first) useAppStore.getState().setHeldRom(first.id)
        return
      }
      if (item.kind === 'coffeemaker') {
        const app = useAppStore.getState()
        // A full pot pours: E hands you the cup, coffee in it — as long as the
        // cup is home by the machine. With the cup somewhere in the room the
        // pot just stands ready, and the HUD says what to go and find.
        if (app.readyPots[id]) {
          if (!('cup' in useLibraryStore.getState().props)) {
            app.drainPot(id)
            app.setHeldProp({ kind: 'cup', full: true })
          }
          return
        }
        app.brew(id)
        return
      }
      // Ring for food. The box turns up at the porch steps a while later.
      if (item.kind === 'phone') {
        useAppStore.getState().order()
        return
      }
      // The fridge never runs out of cans, the way the box stack never runs
      // out of cardboard: cold drinks are not the scarce thing here.
      if (item.kind === 'fridge') {
        useAppStore.getState().setHeldProp({ kind: 'can', full: true })
        return
      }
      // The headlamp goes on your head, or back on its hook. Worn, not held:
      // the whole point is both hands free for books in the dark.
      if (item.kind === 'headlamp') {
        const app = useAppStore.getState()
        app.setWornLamp(app.wornLamp === id ? null : id)
        return
      }
      // The catalogue terminal. A search is typed, so it takes the keyboard the
      // way a shelf label does and gives it back the same way.
      if (item.kind === 'computer') {
        useAppStore.getState().setSearching(true)
        return
      }
      // A pad of notes: peel one off and write on it. The same field `T` opens,
      // because it is the same note — this is only the other way to reach it,
      // and the one you find by walking into the office rather than by reading
      // a key legend.
      if (item.kind === 'postits') {
        const app = useAppStore.getState()
        if (app.heldPin) return
        app.setNoting(true)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Typing a label, a note or a search is typing: W is a letter, not a step
      // — and behind the main menu or the settings panel there is no room to
      // walk in yet.
      if (!roomHasKeyboard()) return
      keys.current.add(e.code)
      if (useAppStore.getState().mode !== 'walk') return

      // Auto-repeat moves you; it does not act for you. Every verb below is
      // one-shot. The movement keys are exempt: they are read from the *set*,
      // which a repeat cannot change.
      if (e.repeat) return

      if (e.code === 'KeyE') {
        e.preventDefault()
        takeOrPlace()
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        // Aimed at the cat, F asks it for a book — there is no book under the
        // crosshair to draw out when a cat is standing in front of it, so the
        // two never compete.
        const { focusedBook, focusedCat, drawn, setDrawn, heldMarker, cycleInk, heldProp } =
          useAppStore.getState()
        // Drink or eat what is in your hand. The coffee is the one with an
        // effect: a quarter quicker on your feet until it wears off. An empty
        // has nothing left in it but a trip to the bin.
        if (heldProp !== null) {
          useAppStore.getState().consume()
          return
        }
        // With the marker in hand, F is the next pen in the tray. It cannot
        // collide with drawing a book out: the crosshair offers nothing but
        // whiteboards while you are holding it.
        if (heldMarker !== null) {
          cycleInk()
          return
        }
        if (focusedCat) {
          askCatForBook()
          return
        }
        // A record comes back off its deck, and a tape back out of the set.
        // Without this neither could ever be carried away again: both are
        // hidden while they play, so there is nothing in the crate to reach for.
        const app = useAppStore.getState()
        const music = useMediaStore.getState()
        const video = useVideoStore.getState()
        const handsFree =
          app.held === null &&
          app.heldRecord === null &&
          app.heldTape === null &&
          app.heldRom === null
        if (app.focusedFixture && handsFree) {
          const piece = useWorldStore
            .getState()
            .world?.furniture.find((item) => item.id === app.focusedFixture)
          if (piece?.kind === 'recordplayer' && music.playing && music.deck === app.focusedFixture) {
            const taken = music.playing
            music.stop()
            app.setHeldRecord(taken)
            return
          }
          if (piece?.kind === 'crt' && video.playing) {
            const taken = video.playing
            video.stop()
            app.setHeldTape(taken)
            return
          }
          // The cartridge comes back out of the machine, screen going dark.
          if (piece?.kind === 'arcade') {
            const arcade = useArcadeStore.getState()
            if (arcade.inserted) {
              const taken = arcade.inserted
              arcade.eject()
              app.setHeldRom(taken)
              return
            }
          }
        }
        // Draw the book under the crosshair out of the shelf to look at its
        // cover, or push it back. Nothing turns on its own.
        if (drawn !== null) setDrawn(null)
        else if (focusedBook) setDrawn(focusedBook)
      } else if (e.code === 'KeyV') {
        e.preventDefault()
        // Call the cat. `C` would have been the obvious key and is already the
        // other way to kneel, which is a thing you do at a bottom shelf far more
        // often than you call an animal.
        callCat()
      } else if (
        e.code === 'Comma' ||
        e.code === 'Period' ||
        e.code === 'BracketLeft' ||
        e.code === 'BracketRight'
      ) {
        // Riffle through the box you are looking at. A box shows the top of the
        // pile; this is how you get at the rest of it without unpacking.
        // Comma and period are the advertised pair — the brackets still work,
        // but on many layouts (QWERTZ among them) they need AltGr, which is a
        // lot to ask of "look at the next few books".
        const { focusedBox, browseBox } = useAppStore.getState()
        if (focusedBox) {
          e.preventDefault()
          browseBox(focusedBox, e.code === 'Period' || e.code === 'BracketRight' ? 1 : -1)
        }
      } else if (e.code === 'KeyG') {
        e.preventDefault()
        // Unpack the box you are looking at onto the shelves, or — with the
        // marker in hand — wipe the board you are looking at. Deliberately not
        // E in either case: both throw away a lot of work at once, and neither
        // must be what happens when you meant to pick one book up, or draw.
        const { held, focusedBox, heldMarker, boardTarget } = useAppStore.getState()
        if (heldMarker !== null) {
          if (boardTarget) useLibraryStore.getState().wipeBoard(boardTarget)
          return
        }
        if (held === null && focusedBox) {
          useLibraryStore.getState().emptyBoxOntoShelves(focusedBox)
        }
      } else if (e.code === 'KeyH') {
        e.preventDefault()
        useAppStore.getState().toggleHud()
      } else if (e.code === 'F1') {
        e.preventDefault()
        const app = useAppStore.getState()
        app.setControlsOpen(!app.controlsOpen)
      } else if (e.code === 'Escape' && useAppStore.getState().controlsOpen) {
        useAppStore.getState().setControlsOpen(false)
      } else if (e.code === 'Escape' && useAppStore.getState().drawn !== null) {
        useAppStore.getState().setDrawn(null)
      } else if (e.code === 'Escape' && useAppStore.getState().seat !== null) {
        useAppStore.getState().setSeat(null)
      } else if (e.code === 'KeyN') {
        e.preventDefault()
        // Day to night and back. On the keyboard rather than only in the panel
        // because it is something you do *in* the room, like switching a lamp.
        useAmbienceStore.getState().toggleNight()
      } else if (e.code === 'KeyK') {
        e.preventDefault()
        // Rain on and off, next to night for the same reason: it is weather,
        // not a setting, and it is saved beside the lamps.
        useAmbienceStore.getState().toggleRain()
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        const { held, setReading, setMode } = useAppStore.getState()
        // Both formats open: a PDF is rasterised and an EPUB is set in type.
        // See `reader/source.ts`.
        if (held) {
          setReading(held)
          setMode('read')
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code)
    // Losing focus mid-stride would otherwise leave the key stuck down.
    const onBlur = () => keys.current.clear()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      void canvas
    }
  }, [gl])

  useEffect(() => {
    const canvas = gl.domElement

    const onClick = () => {
      // Not from behind the main menu or a panel: grabbing the pointer out from
      // under a button somebody is aiming at is the worst kind of surprise.
      if (!roomHasKeyboard()) return
      if (useAppStore.getState().mode === 'walk' && !document.pointerLockElement) {
        void canvas.requestPointerLock()
      }
    }
    const settle = () => {
      settleUntil.current = performance.now() + SETTLE_MS
      handSpeed.current = 0
    }
    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas
      if (locked) settle()
      setPointerLocked(locked)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      if (performance.now() < settleUntil.current) return
      if (Math.abs(e.movementX) > MAX_STEP_PX || Math.abs(e.movementY) > MAX_STEP_PX) return

      const step = Math.hypot(e.movementX, e.movementY)
      const ceiling = Math.max(SPIKE_FLOOR, handSpeed.current * SPIKE_RATIO)
      if (step > ceiling) return
      // Only believed events move the average, or one spike raises the bar for
      // the next one and a burst walks itself through the guard.
      handSpeed.current += (step - handSpeed.current) * 0.2

      const sensitivity = MOUSE * turnScale.current * useSettings.getState().sensitivity
      player.yaw -= e.movementX * sensitivity
      player.pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, player.pitch - e.movementY * sensitivity),
      )
    }

    // The wheel is what a hand does to a box of books, so it browses the one
    // you are looking at and does nothing at all anywhere else.
    const onWheel = (e: WheelEvent) => {
      const { mode, focusedBox, browseBox } = useAppStore.getState()
      if (mode !== 'walk' || !focusedBox || e.deltaY === 0) return
      e.preventDefault()
      browseBox(focusedBox, e.deltaY > 0 ? 1 : -1)
    }

    // Right button held is the other way to zoom. `contextmenu` has to be
    // swallowed or the browser's menu opens over the room on the way down.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2) rightDown.current = true
    }
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) rightDown.current = false
    }
    // Losing the window with the button down would otherwise leave it stuck —
    // and coming *back* is the other moment a screen-scale delta arrives, so
    // both edges re-settle.
    const onBlur = () => {
      rightDown.current = false
      settle()
    }
    const onFocus = () => settle()
    const onContextMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [gl, setPointerLocked])

  // Release the pointer when leaving walk mode, and — coming the other way —
  // ease the camera off the page rather than cutting to head height.
  const wasReading = useRef(false)
  useEffect(() => {
    if (mode !== 'walk') {
      wasReading.current = true
      if (document.pointerLockElement) document.exitPointerLock()
      return
    }
    if (wasReading.current) {
      wasReading.current = false
      handoff.current = HANDOFF_SECONDS
    }
  }, [mode])

  /**
   * Take the pointer back when the catalogue closes. It is opened with `E` and
   * closed with `Esc`, so nothing else would reclaim the lock. `Esc` counts as
   * user activation, which is what makes this allowed.
   */
  const searching = useAppStore((s) => s.searching)
  const wasSearching = useRef(false)
  useEffect(() => {
    const closed = wasSearching.current && !searching
    wasSearching.current = searching
    if (!closed || mode !== 'walk' || !roomHasKeyboard()) return
    // Wrapped because a refused lock is a rejected promise on modern Chrome and
    // a bare `void` on older typings — and headless, where it is refused every
    // time, an unhandled rejection is a console error the smoke tests fail on.
    if (!document.pointerLockElement) {
      void Promise.resolve(gl.domElement.requestPointerLock()).catch(() => {})
    }
  }, [searching, mode, gl])

  // --- movement --------------------------------------------------------

  /** Put the camera where the player is. One place, so the hand-off applies to all three branches. */
  const eye = useMemo(() => new THREE.Vector3(), [])
  const aim = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [])
  const want = useMemo(() => new THREE.Quaternion(), [])
  const place = (x: number, y: number, z: number, delta: number) => {
    eye.set(x, y, z)
    aim.set(player.pitch, player.yaw, 0)
    want.setFromEuler(aim)

    if (handoff.current > 0) {
      handoff.current = Math.max(0, handoff.current - delta)
      const ease = approach(HANDOFF_RATE, delta)
      camera.position.lerp(eye, ease)
      camera.quaternion.slerp(want, ease)
      return
    }
    camera.position.copy(eye)
    camera.quaternion.copy(want)
  }

  useFrame((_, rawDelta) => {
    if (mode !== 'walk') return
    const delta = Math.min(rawDelta, 1 / 20)

    // A panel opening while a key is *held* would otherwise leave you walking
    // through it: the key handler stops taking new presses, but the one already
    // in the set is what the movement below reads.
    if (!roomHasKeyboard()) keys.current.clear()

    // Zoom, and — the same line does both — taking the field of view back from
    // the reader, which narrows it to dock on a page. Eased towards whatever the
    // zoom asks for, so closing a book opens the view rather than cutting to it.
    //
    // Read from the keys directly rather than from the movement code below,
    // because zoom is not movement: it works sitting down, and sitting down
    // returns before any of that runs.
    const zoomHeld = rightDown.current || [...keys.current].some((code) => ZOOM_KEYS.has(code))
    const wantZoom = zoomHeld ? 1 : 0
    player.zoom += Math.sign(wantZoom - player.zoom) * Math.min(
      Math.abs(wantZoom - player.zoom),
      delta * ZOOM_RATE,
    )

    const perspective = camera as THREE.PerspectiveCamera
    if (perspective.isPerspectiveCamera) {
      // Interpolated on the *tangent* rather than on the angle, so the picture
      // grows at an even rate instead of accelerating into the close end.
      const wide = Math.tan(((WALK_FOV / 2) * Math.PI) / 180)
      const tight = Math.tan(((ZOOM_FOV / 2) * Math.PI) / 180)
      const now = wide + (tight - wide) * player.zoom
      const fov = ((2 * Math.atan(now)) / Math.PI) * 180
      turnScale.current = now / wide
      if (Math.abs(perspective.fov - fov) > 1e-4) {
        perspective.fov = fov
        perspective.updateProjectionMatrix()
      }
      player.fov = fov
    }

    const seatId = useAppStore.getState().seat
    const seat = seatId ? world?.furniture.find((item) => item.id === seatId) : undefined

    if (seat) {
      // Sat down: the chair holds you. Look around all you like, but the only
      // way to move is to stand up, which is what a chair is for.
      velocity.current.x = 0
      velocity.current.z = 0
      player.speed = 0
      // Just forward of the chair's centre, so the backrest is behind you
      // rather than through you. Eased, not assigned: E from a step away used
      // to hard-cut the camera to the chair.
      const forwardX = Math.sin(seat.rotationY)
      const forwardZ = Math.cos(seat.rotationY)
      const settle = approach(8, delta)
      const restX = seat.x + forwardX * 0.06
      const restZ = seat.z + forwardZ * 0.06
      player.x += (restX - player.x) * settle
      player.z += (restZ - player.z) * settle
      // An exponential ease approaches forever and arrives never, which for
      // somebody sitting perfectly still is a position that keeps creeping by a
      // millimetre a second. Close enough is sat down.
      if (Math.hypot(restX - player.x, restZ - player.z) < 0.002) {
        player.x = restX
        player.z = restZ
      }
      player.crouch = 0
      player.floor = seat.y
      player.eye += (seat.y + SEATED_EYE - player.eye) * settle
      // The bob's *weight* is what carries it out, so sitting down from a
      // stride winds the head down rather than stopping it mid-step.
      bobWeight.current += (0 - bobWeight.current) * approach(6, delta)

      place(player.x, player.eye, player.z, delta)
      return
    }

    const pressed = keys.current
    let forward = 0
    let strafe = 0
    for (const code of pressed) {
      if (FORWARD_KEYS.has(code)) forward += 1
      if (BACK_KEYS.has(code)) forward -= 1
      if (LEFT_KEYS.has(code)) strafe -= 1
      if (RIGHT_KEYS.has(code)) strafe += 1
    }

    // Kneel, to read the bottom shelf. Held rather than toggled: you go back up
    // by letting go, which is the only thing anyone tries.
    let kneeling = false
    for (const code of pressed) if (KNEEL_KEYS.has(code)) kneeling = true
    const wantCrouch = kneeling ? 1 : 0
    player.crouch += Math.sign(wantCrouch - player.crouch) * Math.min(
      Math.abs(wantCrouch - player.crouch),
      delta * CROUCH_RATE,
    )
    const running = !kneeling && (pressed.has('ShiftLeft') || pressed.has('ShiftRight'))
    // The coffee, while it lasts. It does not make kneeling any less a shuffle.
    const brisk = !kneeling && performance.now() < player.boostUntil ? COFFEE_BOOST : 1
    const top = (kneeling ? KNEEL_SPEED : running ? RUN : WALK) * brisk

    // Normalise so diagonals are not faster than straight lines.
    const magnitude = Math.hypot(forward, strafe)
    if (magnitude > 0) {
      forward /= magnitude
      strafe /= magnitude
    }

    const sin = Math.sin(player.yaw)
    const cos = Math.cos(player.yaw)
    const wantX = (-sin * forward + cos * strafe) * top
    const wantZ = (-cos * forward - sin * strafe) * top

    const ease = approach(magnitude > 0 ? ACCELERATION : BRAKING, delta)
    velocity.current.x += (wantX - velocity.current.x) * ease
    velocity.current.z += (wantZ - velocity.current.z) * ease
    // Below a crawl there is nothing left to ease towards, and a velocity that
    // decays forever is a player who never quite stops — which shows up as the
    // crosshair drifting off a spine you had lined up.
    if (magnitude === 0 && Math.hypot(velocity.current.x, velocity.current.z) < 0.02) {
      velocity.current.x = 0
      velocity.current.z = 0
    }

    // A live reload can pull the floor out from under you — a room deleted, a
    // loft moved — and a teleport does not say which storey it meant. Either
    // way, re-ground rather than leave someone standing in mid-air.
    if (world && floorAt(world, player.x, player.z, player.floor) === null) {
      player.floor = groundAt(world, player.x, player.z, player.floor)
    }

    const next = world
      ? stepPlayer(
          world,
          solids,
          player,
          {
            x: player.x + velocity.current.x * delta,
            z: player.z + velocity.current.z * delta,
          },
          PLAYER_RADIUS,
        )
      : { x: player.x, z: player.z, floor: player.floor }

    // Kill the component that was blocked, so we do not keep pushing into a wall.
    if (next.x === player.x) velocity.current.x = 0
    if (next.z === player.z) velocity.current.z = 0
    player.x = next.x
    player.z = next.z
    // Ease onto a new floor rather than snapping: a staircase is a ramp, and
    // stepping over a threshold should read as a step rather than a jolt.
    player.floor += (next.floor - player.floor) * approach(14, delta)
    if (Math.abs(next.floor - player.floor) < 0.005) player.floor = next.floor

    // Eased rather than assigned so standing up from a chair rises instead of
    // snapping; crouch and floor changes carry their own easing already, so
    // this settles to the exact height within a few frames.
    const wantEye = player.floor + EYE_HEIGHT + (KNEEL_HEIGHT - EYE_HEIGHT) * player.crouch
    player.eye += (wantEye - player.eye) * approach(10, delta)
    if (Math.abs(wantEye - player.eye) < 0.002) player.eye = wantEye

    player.speed = Math.hypot(velocity.current.x, velocity.current.z)

    // Head bob, advanced by *distance walked* rather than by time, so it never
    // runs on while you stand still. Two components: vertical at twice the
    // stride (one dip per foot), sideways at the stride (a sway onto each leg).
    bob.current += delta * player.speed * 7.5
    const want = Math.min(1, player.speed / WALK)
    bobWeight.current += (want - bobWeight.current) * approach(6, delta)
    const weight = bobWeight.current
    const rise = Math.sin(bob.current * 2) * 0.018 * weight
    const sway = Math.sin(bob.current) * 0.012 * weight

    place(
      player.x + Math.cos(player.yaw) * sway,
      player.eye + rise,
      player.z - Math.sin(player.yaw) * sway,
      delta,
    )
  })

  return null
}
