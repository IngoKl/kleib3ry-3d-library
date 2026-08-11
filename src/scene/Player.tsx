import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { groundAt, stepPlayer } from './walk'
import { askCatForBook, callCat, petCat } from './Cat'
import { floorAt } from '../world/derive'
import { shelfColliders } from '../world/shelf'
import { EYE_HEIGHT, KNEEL_HEIGHT, PLAYER_RADIUS, SEATED_EYE, player } from '../state/player'
import { roomHasKeyboard, useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
import { useSettings } from '../state/settings'
import { approach } from '../lib/ease'
import { LAMPS } from '../world/derive'

const WALK_FOV = 72
/**
 * Zoomed. Not a toggle: held, like kneeling, because you lean in to read one
 * spine and then stop — and a view you can leave narrowed is a view you will
 * eventually wonder why you cannot walk straight in.
 *
 * 26 degrees is about a 2.8x magnification, which is enough to read a printed
 * spine from across the great room and still know which room you are in.
 */
const ZOOM_FOV = 26
const ZOOM_KEYS = new Set(['KeyZ'])
/** How fast the view closes in and opens back out, in units of zoom a second. */
const ZOOM_RATE = 5.5

const WALK = 1.6
const RUN = 3.0
/** Kneeling is a shuffle, not a walk. */
const KNEEL_SPEED = 0.7
/** How fast you go down and come back up, in units of crouch per second. */
const CROUCH_RATE = 4.5

const KNEEL_KEYS = new Set(['ControlLeft', 'ControlRight', 'KeyC'])

/** How quickly velocity reaches the target. Low enough to feel like a body. */
const ACCELERATION = 12
/**
 * …and how quickly it comes back down, which is deliberately quicker.
 *
 * Accelerating like a body and stopping like one are different problems: a
 * slow build-up reads as weight, and a slow stop reads as ice. Letting go of
 * `W` a pace short of a bookcase should put you a pace short of it.
 */
const BRAKING = 20
const MOUSE = 0.0022
const PITCH_LIMIT = Math.PI / 2 - 0.08

/**
 * Pointer lock is not a clean source of deltas, and this is what "the view
 * sometimes jumps" turned out to be.
 *
 * The event that engages a lock carries the movement since the pointer was last
 * seen — often most of the screen. WebView2 emits screen-scale deltas after a
 * focus change, sometimes several frames running. And a browser that has just
 * re-locked after an alt-tab can deliver a burst before it settles.
 *
 * Swallowing exactly one event was not enough, because the burst is more than
 * one event; a fixed pixel cap was not enough either, because a genuine fast
 * flick and a spurious jump are the same size. So there are three guards, and
 * each catches what the others cannot:
 *
 *   - **a settling window** after a lock or a focus change, during which no
 *     delta is believed at all. 180 ms is long enough to cover the burst and
 *     short enough that nobody notices their first flick was eaten;
 *   - **a hard ceiling**, which no wrist reaches between two frames;
 *   - **a relative ceiling**, against a running average of how fast the hand is
 *     actually moving — which is what catches a 300-pixel spike in the middle
 *     of a slow, careful pan along a shelf, where the hard cap never fires.
 *
 * Losing one event off a genuinely violent flick costs a few degrees of turn.
 * That is much the cheaper failure.
 */
const MAX_STEP_PX = 400
const SETTLE_MS = 180
/** How many times the recent average a single event may be before it is a spike. */
const SPIKE_RATIO = 8
/** …but never below this, or ordinary acceleration off a standstill reads as one. */
const SPIKE_FLOOR = 120

/**
 * How fast the camera comes back to your own eyes after a book closes.
 *
 * Read mode docks the camera onto the page; walking puts it back at head height.
 * Assigning it was a hard cut from the page to the room every single time a book
 * was closed — which is the other half of "the view sometimes jumps", and the
 * half that happens on purpose.
 */
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
   * How much to scale a mouse delta by, written by the frame loop.
   *
   * Turning has to slow down as the view narrows or a zoomed view is unusable:
   * the same wrist movement that sweeps a room at 72 degrees throws the picture
   * off the screen at 26. Scaled by the ratio of the tangents, which is what
   * makes a given movement of the hand cover the same distance *on screen* at
   * any zoom.
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

      /**
       * A sheet in your hand goes on the wall you are aiming at, and comes back
       * off it the same way.
       *
       * First, before anything else E does, because it cannot collide with any
       * of it: a wall is not somewhere a book, a record or a tape can go, so
       * `pinTarget` is only ever set when pinning is the *only* thing E could
       * mean. A little tilt, from the position, so a board of pages does not look
       * like a spreadsheet.
       */
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

      // Holding a record: the deck plays it, a crate takes it back. Its place
      // in the crate is derived from the folder, so filing it is just letting
      // go of it.
      if (heldRecord !== null) {
        if (focusedFixture) {
          useMediaStore.getState().play(heldRecord)
          setHeldRecord(null)
          return
        }
        if (crateTarget) setHeldRecord(null)
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

      if (held === null) {
        // A fuss. Before everything else in this branch because the crosshair
        // only ever offers the cat when it is offering nothing else.
        if (state.focusedCat) {
          petCat()
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
          yaw: player.yaw + Math.PI,
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

    /**
     * Working something: a lamp, the deck, the coffee maker.
     *
     * All three are E on the thing itself rather than a switch on the wall,
     * because a switch you have to find is a puzzle and a lamp you can just
     * reach out and click is a room.
     */
    const operate = (id: string) => {
      const world = useWorldStore.getState().world
      const item = world?.furniture.find((piece) => piece.id === id)
      if (!item) return

      if (LAMPS.has(item.kind)) {
        useLightStore.getState().toggle(id, item.on ?? true)
        return
      }
      if (item.kind === 'recordplayer') {
        const music = useMediaStore.getState()
        // Nothing on the deck yet: start at the top of the collection.
        if (music.playing) music.play(music.playing)
        else if (music.tracks[0]) music.play(music.tracks[0].id)
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
      if (item.kind === 'coffeemaker') {
        useAppStore.getState().brew(id)
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

      /**
       * Auto-repeat moves you; it does not act for you.
       *
       * Holding a key fires `keydown` thirty times a second once the operating
       * system's repeat kicks in, and every verb below is a thing you meant to do
       * once. Holding `N` strobed the room between day and night, holding `E`
       * took a book off a shelf and put it back over and over, and holding `X`
       * did the same to a moving box. The movement keys are exempt because they
       * are read from the *set*, which a repeat cannot change.
       */
      if (e.repeat) return

      if (e.code === 'KeyE') {
        e.preventDefault()
        takeOrPlace()
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        // Aimed at the cat, F asks it for a book — there is no book under the
        // crosshair to draw out when a cat is standing in front of it, so the
        // two never compete.
        const { focusedBook, focusedCat, drawn, setDrawn } = useAppStore.getState()
        if (focusedCat) {
          askCatForBook()
          return
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
        // Unpack the box you are looking at onto the shelves. Deliberately not
        // E: emptying a box is a hundred books moving at once, and it must not
        // be what happens when you meant to pick one up and hit the cardboard.
        const { held, focusedBox } = useAppStore.getState()
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
        useLightStore.getState().toggleNight()
      } else if (e.code === 'KeyK') {
        e.preventDefault()
        // Rain on and off, next to night for the same reason: it is weather,
        // not a setting, and it is saved beside the lamps.
        useLightStore.getState().toggleRain()
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        const { held, setReading, setMode } = useAppStore.getState()
        // Both formats open now: a PDF is rasterised and an EPUB is set in type
        // — see `reader/source.ts`. The format check that used to live here was
        // the last thing standing between an EPUB and being a book.
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

  // --- movement --------------------------------------------------------

  /**
   * Put the camera where the player is.
   *
   * One place rather than three assignments in three branches, because the
   * hand-off off a closed book has to apply to all of them — including the
   * seated one, which returns early.
   */
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

    // Zoom, and — because the same line does the job — taking the field of view
    // back from the reader, which narrows it to dock on a page. It used to be
    // snapped back to exactly 72; now it is eased towards whatever the zoom
    // asks for, which means closing the book opens the view rather than
    // cutting to it.
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
    const top = kneeling ? KNEEL_SPEED : running ? RUN : WALK

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

    /**
     * Head bob, advanced by *distance walked* rather than by time, so it never
     * runs on while you stand still and never skates while you are blocked
     * against a wall — `player.speed` is what actually moved, not what was asked
     * for. Its weight eases in and out separately, so starting and stopping do
     * not begin and end mid-step.
     *
     * Two components, because a walk is not a pogo stick: the vertical one is at
     * twice the stride (one dip per foot) and the sideways one is at the stride
     * itself (a sway onto each leg in turn). Both are small enough to be felt
     * rather than seen.
     */
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
