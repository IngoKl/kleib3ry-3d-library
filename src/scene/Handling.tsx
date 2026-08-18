import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FURNITURE_SIZE, PORTABLE, supportAt } from '../world/derive'
import { makeHand } from './hand'
import { launchBody, throwFrom } from './drop'
import { playOneShot } from './ambientSound'
import { pressSatchel, type SatchelItem } from '../state/satchel'
import { roomHasKeyboard, useAppStore } from '../state/store'
import { NEW_BOX, useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'
import { player } from '../state/player'

/**
 * The verbs that are not "take" and "put on a shelf", kept out of the walk
 * controller because they are about things rather than about walking:
 *
 *   Q  drop what you are holding, on the floor, with gravity
 *   O  put it down open at the page you were on
 *   I  the satchel — stow the book or record in your hand, or take one out
 *   L  write a label on the bookcase you are looking at
 *   T  write a note, to stick on a wall
 *   X  pick up or set down a box, a folding chair or a folding table
 *   Backspace  break down the empty box you are looking at
 *
 * `E` stays the walk controller's: it is the same reach that takes a book off a
 * shelf, and pinning a sheet to a wall is that same reach.
 */

/** How far in front of you what you are carrying floats, and how far below your eyes. */
const CARRY_AHEAD = 0.72
const CARRY_DROP = 0.58

export function Handling() {
  const carried = useAppStore((s) => s.carried)
  const world = useWorldStore((s) => s.world)
  const ghost = useRef<THREE.Group>(null)
  /** The lagged yaw the ghost is drawn at — the set-down commits to the same
      one, or the preview and the landing spot disagree mid-turn. */
  const carryYaw = useRef(player.yaw)

  // A box off the stack has no furniture entry yet; it previews at the kind's
  // own size, which is the size it will be when it lands.
  const piece =
    carried === NEW_BOX
      ? { kind: 'box' as const, ...FURNITURE_SIZE.box }
      : world?.furniture.find((item) => item.id === carried)
  const folded = piece !== undefined && PORTABLE.has(piece.kind)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const app = useAppStore.getState()
      // Auto-repeat is not an instruction — see the note in `Player.tsx`.
      // Everything in here is a one-shot verb, so all of them are exempt.
      if (e.repeat || !roomHasKeyboard() || app.mode !== 'walk') return
      const shelf = useLibraryStore.getState()
      const live = useWorldStore.getState().world

      if (e.code === 'KeyQ') {
        e.preventDefault()
        // The marker goes back on its tray, wherever you are standing.
        if (app.heldMarker) {
          app.setHeldMarker(null)
          return
        }
        // A record has no loose life on the floor: letting go sends it back to
        // the crate the folder deals it into. Putting one somewhere is E.
        if (app.heldRecord) {
          shelf.freeRecord(app.heldRecord)
          app.setHeldRecord(null)
          return
        }
        // Nor does a tape. Letting go of one puts it back in its crate.
        if (app.heldTape) {
          app.setHeldTape(null)
          return
        }
        // Nor a cartridge: it lives in the ROM box, and goes back there.
        if (app.heldRom) {
          app.setHeldRom(null)
          return
        }
        // Screwed up and thrown away — only with your hands otherwise empty,
        // because with a book in one of them Q plainly means the book.
        if (app.heldPin && !app.held) {
          app.setHeldPin(null)
          return
        }
        // Down at your feet, on the floor or on whatever tabletop is there.
        // Nothing bounces: none of it is worth a physics body.
        if (app.heldProp && live) {
          const x = player.x - Math.sin(player.yaw) * 0.5
          const z = player.z - Math.cos(player.yaw) * 0.5
          const y = supportAt(live, x, z, player.floor + 0.4)
          shelf.placeProp({
            kind: app.heldProp.kind,
            full: app.heldProp.full,
            x,
            y: y + 0.002,
            z,
            yaw: player.yaw,
          })
          app.setHeldProp(null)
          return
        }
        // In front of you, then wherever it rolls — the one thing in the room
        // that is not where you put it. Kneeling, Q places rather than throws.
        if (!app.held) return
        const size = shelf.dims.get(app.held)
        if (!size) return
        const body = throwFrom(player, size, player.crouch > 0.5)
        // The placement is only where the book leaves your hand; the body —
        // with the velocity of the throw — is what actually falls.
        launchBody(app.held, body)
        shelf.putDown(app.held, {
          x: body.x,
          y: body.y,
          z: body.z,
          yaw: body.yaw,
          open: false,
          spread: 0,
        })
        app.setHeld(null)
        return
      }

      if (e.code === 'KeyI') {
        e.preventDefault()
        // Both arms round a box: nothing goes in or out of the bag.
        if (app.carried) return
        const hand: SatchelItem | null = app.held
          ? { kind: 'book', id: app.held }
          : app.heldRecord
            ? { kind: 'record', id: app.heldRecord }
            : null
        // Taking out needs a free hand, and nothing else stows — a tape, a
        // cartridge, the marker and the crockery all live somewhere already.
        if (
          hand === null &&
          (app.heldTape || app.heldRom || app.heldProp || app.heldMarker || app.heldPin)
        ) {
          app.notify('Only a book or a record goes in the satchel.')
          return
        }
        const press = pressSatchel(app.satchel, hand)
        if (!press.moved) {
          app.notify('The satchel is empty.')
          return
        }
        app.setSatchel(press.satchel)
        if (hand) (hand.kind === 'book' ? app.setHeld : app.setHeldRecord)(null)
        if (press.taken) {
          ;(press.taken.kind === 'book' ? app.setHeld : app.setHeldRecord)(press.taken.id)
        }
        playOneShot('rustle', 0.5, { rate: 0.95 + Math.random() * 0.1 })
        return
      }

      if (e.code === 'KeyO') {
        e.preventDefault()
        // Open, at the page you were on. Onto the table you are looking at, or
        // onto the floor in front of you.
        if (!app.held || !live) return
        const spread = shelf.readProgress[app.held] ?? 0
        const target = app.surfaceTarget
        const x = target ? target.x : player.x - Math.sin(player.yaw) * 0.55
        const z = target ? target.z : player.z - Math.cos(player.yaw) * 0.55
        const y = target ? target.y : supportAt(live, x, z, player.floor + 0.4)

        shelf.putDown(app.held, {
          x,
          y: y + 0.004,
          z,
          // Your own yaw, not the reverse: a page laid flat rests with its head
          // along -Z, so `yaw` alone points the top of the spread away from you.
          // A further 180° lays the book down upside down.
          yaw: player.yaw,
          open: true,
          spread,
        })
        app.setHeld(null)
        return
      }

      if (e.code === 'KeyL') {
        e.preventDefault()
        // The shelf position under the crosshair, else the case the focused
        // book stands in, else the carcass — which is what makes an empty
        // bookcase labellable at all.
        const shelfId =
          app.shelfTarget?.shelfId ??
          shelf.packed.find((item) => item.id === app.focusedBook)?.shelfId ??
          app.focusedShelf
        if (shelfId) app.setLabelling(shelfId)
        return
      }

      if (e.code === 'KeyT') {
        e.preventDefault()
        // It arrives in your hand rather than on the wall, because where it
        // goes is a separate decision you make by looking. Refused rather than
        // queued with a full hand: replacing a sheet silently throws away work.
        if (app.heldPin) return
        app.setNoting(true)
        return
      }

      if (e.code === 'KeyX') {
        e.preventDefault()
        if (app.carried) {
          setDown(app.carried)
          return
        }
        // Only with your hands free: a box needs both. The folding chair and
        // table share the key because it is the one verb meaning "take this".
        const pickUp = app.focusedPortable ?? app.focusedBox
        if (app.held === null && pickUp) {
          app.setCarried(pickUp)
          playOneShot('cardboard', app.focusedPortable ? 0.5 : 0.8, {
            rate: app.focusedPortable ? 1.35 : 1,
          })
        }
        return
      }

      if (e.code === 'Backspace') {
        // Its own key, with "delete" written into it: G on the same box shelves
        // a boxful, and the two must not share one key. `deleteBox` refuses a
        // box with books in it.
        if (app.held === null && app.carried === null && app.focusedBox) {
          e.preventDefault()
          // Only a break-down that happened sounds: `deleteBox` refuses a boxful.
          if (shelf.deleteBox(app.focusedBox)) playOneShot('cardboard', 0.9, { rate: 0.8 })
        }
      }
    }

    /**
     * Committed once here rather than every frame while carried: moving
     * furniture re-derives the world and re-reconciles the library, which is
     * right for an edit and quite wrong at sixty hertz.
     */
    const setDown = (id: string) => {
      const app = useAppStore.getState()
      const live = useWorldStore.getState().world
      app.setCarried(null)
      playOneShot('cardboard', 0.9, { rate: 0.9 })

      // The ghost's own yaw, not the player's: what you saw is what lands.
      const yaw = carryYaw.current
      const x = player.x - Math.sin(yaw) * CARRY_AHEAD
      const z = player.z - Math.cos(yaw) * CARRY_AHEAD
      // Snapped to a quarter turn so a set-down box reads as placed rather than
      // dropped. A look, not a constraint: the AABBs cover any facing.
      const facing = Math.round((yaw * 180) / Math.PI / 90) * 90

      // A box fresh off the stack becomes real furniture here, where it first
      // touches the floor.
      if (id === NEW_BOX) {
        useLibraryStore.getState().spawnBox(x, z, facing, player.floor)
        return
      }

      const piece = live?.furniture.find((item) => item.id === id)
      const room = live?.rooms.find((candidate) => candidate.id === piece?.roomId)
      if (!piece || !room) return

      // Room-local, the frame the document uses: world metres would jump the
      // first time its room moved. The elevation rides along, or a box carried
      // up to the loft derives at ground level.
      useLibraryStore
        .getState()
        .moveFurniture(id, [x - room.origin[0], z - room.origin[1]], facing, player.floor)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Carried on the hand's lagged yaw, like everything held. Only a preview: the
  // real piece stands where it was until you set this one down, at this yaw.
  const camera = useThree((s) => s.camera)
  // Remade per carry: the hand only advances while something is held, so a
  // fresh pickup needs a fresh prime or it swings in from the last facing.
  const hand = useRef(makeHand())
  const lastCarry = useRef<string | null>(null)
  useFrame((_, delta) => {
    const node = ghost.current
    if (!node || !piece) return
    if (carried !== lastCarry.current) {
      lastCarry.current = carried
      hand.current = makeHand()
    }
    const { forward } = hand.current.follow(camera, delta)
    const yaw = Math.atan2(-forward.x, -forward.z)
    carryYaw.current = yaw
    node.position.set(
      player.x - Math.sin(yaw) * CARRY_AHEAD,
      player.eye - CARRY_DROP,
      player.z - Math.cos(yaw) * CARRY_AHEAD,
    )
    node.rotation.y = yaw
  })

  if (!piece) return null

  // Folded, because that is what you would do before picking it up. Two boxes,
  // like the moving box's preview: this exists only while it is off the ground.
  if (folded) {
    const leaf = piece.height + 0.06
    return (
      <group ref={ghost}>
        <group rotation={[0, 0, 0.2]}>
          <mesh castShadow>
            <boxGeometry args={[piece.width, leaf, 0.07]} />
            <meshStandardMaterial color="#b08e63" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.02, 0.055]}>
            <boxGeometry args={[piece.width * 0.82, leaf * 0.88, 0.045]} />
            <meshStandardMaterial color="#7e8177" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      </group>
    )
  }

  return (
    <group ref={ghost}>
      <mesh castShadow>
        <boxGeometry args={[piece.width, piece.height, piece.depth]} />
        <meshStandardMaterial color="#b9915f" roughness={1} />
      </mesh>
      <mesh position={[0, piece.height / 2 + 0.002, 0]}>
        <boxGeometry args={[piece.width * 0.96, 0.006, piece.depth * 0.96]} />
        <meshStandardMaterial color="#a07a4b" roughness={1} />
      </mesh>
    </group>
  )
}
