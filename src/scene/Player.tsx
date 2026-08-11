import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { groundAt, stepPlayer } from './walk'
import { floorAt } from '../world/derive'
import { shelfColliders } from '../world/shelf'
import { EYE_HEIGHT, KNEEL_HEIGHT, PLAYER_RADIUS, SEATED_EYE, player } from '../state/player'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useLightStore } from '../state/lights'
import { useMediaStore } from '../state/media'
import { useVideoStore } from '../state/video'
import { useWorldStore } from '../state/world'
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
const MOUSE = 0.0022
const PITCH_LIMIT = Math.PI / 2 - 0.08

/**
 * Pointer lock is not a clean source of deltas. The event that engages it
 * carries the movement since the pointer was last seen — often most of the
 * screen — and WebView2 emits the occasional screen-scale delta after a focus
 * change. Both land as the view snapping.
 *
 * So: swallow the first move after a lock, and drop any single event past this
 * many pixels. At MOUSE sensitivity that cap is a ~50° turn between two frames,
 * which no wrist produces; losing one event off a genuinely violent flick costs
 * a few degrees of turn, which is the cheaper failure.
 */
const MAX_STEP_PX = 400

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
  const bob = useRef(0)
  /** True between a lock being granted and the first mouse delta being discarded. */
  const settling = useRef(false)
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
      if (item.kind === 'coffeemaker') useAppStore.getState().brew(id)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Typing a shelf label or a note is typing: W is a letter, not a step.
      const app = useAppStore.getState()
      if (app.labelling !== null || app.noting) return
      keys.current.add(e.code)
      if (useAppStore.getState().mode !== 'walk') return

      if (e.code === 'KeyE') {
        e.preventDefault()
        takeOrPlace()
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        // Draw the book under the crosshair out of the shelf to look at its
        // cover, or push it back. Nothing turns on its own.
        const { focusedBook, drawn, setDrawn } = useAppStore.getState()
        if (drawn !== null) setDrawn(null)
        else if (focusedBook) setDrawn(focusedBook)
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
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        const { held, setReading, setMode } = useAppStore.getState()
        if (held) {
          // Only PDFs open; the reader has no text to explain itself with, so
          // docking onto a blank page block for an EPUB is a dead end. The HUD
          // already withholds the R hint for these.
          const book = useLibraryStore.getState().byId.get(held)
          if (book?.format !== 'pdf') return
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
      if (useAppStore.getState().mode === 'walk' && !document.pointerLockElement) {
        void canvas.requestPointerLock()
      }
    }
    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas
      if (locked) settling.current = true
      setPointerLocked(locked)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      if (settling.current) {
        settling.current = false
        return
      }
      if (Math.abs(e.movementX) > MAX_STEP_PX || Math.abs(e.movementY) > MAX_STEP_PX) return

      const sensitivity = MOUSE * turnScale.current
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
    // Losing the window with the button down would otherwise leave it stuck.
    const onBlur = () => {
      rightDown.current = false
    }
    const onContextMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)
    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [gl, setPointerLocked])

  // Release the pointer when leaving walk mode.
  useEffect(() => {
    if (mode !== 'walk' && document.pointerLockElement) document.exitPointerLock()
  }, [mode])

  // --- movement --------------------------------------------------------
  useFrame((_, rawDelta) => {
    if (mode !== 'walk') return
    const delta = Math.min(rawDelta, 1 / 20)

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
      const settle = Math.min(1, delta * 8)
      player.x += (seat.x + forwardX * 0.06 - player.x) * settle
      player.z += (seat.z + forwardZ * 0.06 - player.z) * settle
      player.crouch = 0
      player.floor = seat.y
      player.eye += (seat.y + SEATED_EYE - player.eye) * settle

      camera.position.set(player.x, player.eye, player.z)
      camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')
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

    const ease = Math.min(1, delta * ACCELERATION)
    velocity.current.x += (wantX - velocity.current.x) * ease
    velocity.current.z += (wantZ - velocity.current.z) * ease

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
    player.floor += (next.floor - player.floor) * Math.min(1, delta * 14)
    if (Math.abs(next.floor - player.floor) < 0.005) player.floor = next.floor

    // Eased rather than assigned so standing up from a chair rises instead of
    // snapping; crouch and floor changes carry their own easing already, so
    // this settles to the exact height within a few frames.
    const wantEye = player.floor + EYE_HEIGHT + (KNEEL_HEIGHT - EYE_HEIGHT) * player.crouch
    player.eye += (wantEye - player.eye) * Math.min(1, delta * 10)
    if (Math.abs(wantEye - player.eye) < 0.002) player.eye = wantEye

    player.speed = Math.hypot(velocity.current.x, velocity.current.z)

    // Head bob, scaled by how fast we are actually going.
    bob.current += delta * player.speed * 7.5
    const bobAmount = Math.sin(bob.current * 2) * 0.018 * Math.min(1, player.speed / WALK)

    camera.position.set(player.x, player.eye + bobAmount, player.z)
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')
  })

  return null
}
