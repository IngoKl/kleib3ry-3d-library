import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { resolveMove } from './collision'
import { shelfColliders } from '../world/shelf'
import { EYE_HEIGHT, KNEEL_HEIGHT, PLAYER_RADIUS, SEATED_EYE, player } from '../state/player'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'

const WALK_FOV = 72

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
  // their footprint belongs to the carcass rather than to the document.
  const colliders = useMemo(
    () => (world ? [...world.colliders, ...shelfColliders(world.shelves)] : []),
    [world],
  )
  const keys = useRef(new Set<string>())
  const velocity = useRef({ x: 0, z: 0 })
  const bob = useRef(0)
  /** True between a lock being granted and the first mouse delta being discarded. */
  const settling = useRef(false)

  // --- input -----------------------------------------------------------
  useEffect(() => {
    const canvas = gl.domElement

    /**
     * Empty-handed, E takes the book under the crosshair. Holding one, E puts
     * it wherever you are aiming — a shelf, or back into a box — which is how
     * you rearrange the library.
     */
    const takeOrPlace = () => {
      const { held, focusedBook, focusedSeat, shelfTarget, boxTarget, seat, setHeld, setSeat } =
        useAppStore.getState()
      const shelf = useLibraryStore.getState()

      // Sitting down and getting up are both E, which is the same key you use
      // for everything else you do with your hands. Nothing else is in reach
      // while you are in a chair, so there is no ambiguity to resolve.
      if (seat !== null) {
        setSeat(null)
        return
      }
      if (held === null && focusedSeat !== null) {
        setSeat(focusedSeat)
        return
      }

      if (held === null) {
        if (!focusedBook) return
        useAppStore.getState().setDrawn(null)
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

      // Refuse rather than silently drop the book if the row is full.
      if (!shelfTarget) return
      if (shelf.shelve(held, shelfTarget.shelfId, shelfTarget.row, shelfTarget.index)) {
        setHeld(null)
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
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
      } else if (e.code === 'KeyG') {
        e.preventDefault()
        // Unpack the box you are looking at onto the shelves. Deliberately not
        // E: emptying a box is a hundred books moving at once, and it must not
        // be what happens when you meant to pick one up and hit the cardboard.
        const { held, focusedBox } = useAppStore.getState()
        if (held === null && focusedBox) {
          useLibraryStore.getState().emptyBoxOntoShelves(focusedBox)
        }
      } else if (e.code === 'Escape' && useAppStore.getState().drawn !== null) {
        useAppStore.getState().setDrawn(null)
      } else if (e.code === 'Escape' && useAppStore.getState().seat !== null) {
        useAppStore.getState().setSeat(null)
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        const { held, setReading, setMode } = useAppStore.getState()
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

      player.yaw -= e.movementX * MOUSE
      player.pitch = Math.max(
        -PITCH_LIMIT,
        Math.min(PITCH_LIMIT, player.pitch - e.movementY * MOUSE),
      )
    }

    canvas.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      canvas.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
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

    // The reader narrows the field of view to dock on a page; take it back.
    const perspective = camera as THREE.PerspectiveCamera
    if (perspective.isPerspectiveCamera && perspective.fov !== WALK_FOV) {
      perspective.fov = WALK_FOV
      perspective.updateProjectionMatrix()
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
      // rather than through you.
      const forwardX = Math.sin(seat.rotationY)
      const forwardZ = Math.cos(seat.rotationY)
      player.x = seat.x + forwardX * 0.06
      player.z = seat.z + forwardZ * 0.06
      player.crouch = 0
      player.eye += (SEATED_EYE - player.eye) * Math.min(1, delta * 8)

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
    player.eye = EYE_HEIGHT + (KNEEL_HEIGHT - EYE_HEIGHT) * player.crouch

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

    const next = resolveMove(
      player,
      {
        x: player.x + velocity.current.x * delta,
        z: player.z + velocity.current.z * delta,
      },
      PLAYER_RADIUS,
      colliders,
    )
    // Kill the component that was blocked, so we do not keep pushing into a wall.
    if (next.x === player.x) velocity.current.x = 0
    if (next.z === player.z) velocity.current.z = 0
    player.x = next.x
    player.z = next.z

    player.speed = Math.hypot(velocity.current.x, velocity.current.z)

    // Head bob, scaled by how fast we are actually going.
    bob.current += delta * player.speed * 7.5
    const bobAmount = Math.sin(bob.current * 2) * 0.018 * Math.min(1, player.speed / WALK)

    camera.position.set(player.x, player.eye + bobAmount, player.z)
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')
  })

  return null
}
