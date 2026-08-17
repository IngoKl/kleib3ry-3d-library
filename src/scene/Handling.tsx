import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FURNITURE_SIZE, PORTABLE, supportAt } from '../world/derive'
import { makeHand } from './hand'
import { launchBody, throwFrom } from './drop'
import { playOneShot } from './ambientSound'
import { roomHasKeyboard, useAppStore } from '../state/store'
import { NEW_BOX, useLibraryStore } from '../state/library'
import { useWorldStore } from '../state/world'
import { player } from '../state/player'

/**
 * The verbs that are not "take" and "put on a shelf".
 *
 * Kept out of the walk controller because they are about *things*, not about
 * walking, and because the walk controller was already the file everything got
 * bolted onto. What lives here:
 *
 *   Q  drop what you are holding, on the floor, with gravity
 *   O  put it down open at the page you were on
 *   L  write a label on the bookcase you are looking at
 *   T  write a note, to stick on a wall
 *   X  pick a moving box, a folding chair or a folding table up and carry it,
 *      or set it down again
 *   Backspace  break down the empty box you are looking at
 *
 * `E` is still the walk controller's, because it is the same reach that takes a
 * book off a shelf and it belongs next to that — and pinning a sheet to a wall
 * is that same reach.
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
        // A record has no loose life on the floor: letting go of one sends it
        // back to the crate the folder deals it into, forgetting wherever you
        // had filed or put it. Putting one somewhere on purpose is E.
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
        // A sheet you have decided against is screwed up and thrown away. Only
        // when your hands are otherwise empty, because with a book in one hand
        // Q plainly means the book.
        if (app.heldPin && !app.held) {
          app.setHeldPin(null)
          return
        }
        // A cup, can or box goes down at your feet — on the floor, or on
        // whatever tabletop happens to be there. Nothing bounces: none of it
        // is worth a physics body.
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
        // Drop it. Somewhere in front of you, and then wherever it rolls to —
        // the one thing in the room that is not where you put it. Kneeling, the
        // same key is placing rather than throwing: down there, Q means "here".
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
          // Your own yaw, not the reverse of it. A page laid flat has its head
          // pointing along -Z at rest, and the group's yaw turns that with you —
          // so `yaw` alone points the top of the spread away from you, which is
          // the way round you read it. Turning it through 180° as well laid the
          // book down upside down, and swapped the verso and the recto.
          yaw: player.yaw,
          open: true,
          spread,
        })
        app.setHeld(null)
        return
      }

      if (e.code === 'KeyL') {
        e.preventDefault()
        // Label the case you are aiming at. Holding a book that is the shelf
        // position under the crosshair; otherwise the case the focused book is
        // standing in; failing both, the carcass itself — which is what makes
        // an *empty* bookcase labellable at all.
        const shelfId =
          app.shelfTarget?.shelfId ??
          shelf.packed.find((item) => item.id === app.focusedBook)?.shelfId ??
          app.focusedShelf
        if (shelfId) app.setLabelling(shelfId)
        return
      }

      if (e.code === 'KeyT') {
        e.preventDefault()
        // Write a note. It arrives in your hand rather than on the wall, because
        // where it goes is a separate decision and one you make by looking.
        //
        // Refused rather than queued when your hand is already full: silently
        // replacing the sheet you were about to stick up would throw away work,
        // and the HUD says which key clears it.
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
        // Only with your hands free: a box needs both, and a book in one of
        // them is exactly the thing you would put down first. The folding chair
        // and table are picked up by the same key for the same reason — it is
        // the one verb that means "take this with you".
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
        // Break down the empty box under the crosshair. Its own key, and one
        // with "delete" written into it: G on the same box shelves a boxful,
        // and the two must not sit on neighbouring meanings of one key.
        // `deleteBox` refuses a box with books in it.
        if (app.held === null && app.carried === null && app.focusedBox) {
          e.preventDefault()
          // Only a break-down that happened sounds: `deleteBox` refuses a boxful.
          if (shelf.deleteBox(app.focusedBox)) playOneShot('cardboard', 0.9, { rate: 0.8 })
        }
      }
    }

    /**
     * Put down what you are carrying, where you are standing.
     *
     * Committed once, here, rather than every frame while it is carried:
     * moving furniture re-derives the whole world and re-reconciles the
     * library, which is the right thing to do for an edit and quite the wrong
     * thing to do at sixty hertz.
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
      // Snapped to a quarter turn so a set-down box reads as *placed* rather
      // than dropped. (The collision AABBs now cover any facing, so this is a
      // look, not a constraint.)
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

      // Stored room-local, the frame the document is written in: a box recorded
      // in world metres would jump the first time its room moved. The elevation
      // rides along because the document room only knows its own storey, and a
      // box carried up to the loft would otherwise derive at ground level.
      useLibraryStore
        .getState()
        .moveFurniture(id, [x - room.origin[0], z - room.origin[1]], facing, player.floor)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // What you are carrying rides in front of you on the hand's lagged yaw, like
  // everything else held. Only a preview: the real one stands where it was
  // until you set this one down — at this same yaw, so the preview is honest.
  const camera = useThree((s) => s.camera)
  // Remade per carry: the hand only advances while something is held, so a fresh
  // pickup needs a fresh prime or it swings in from the last carry's facing —
  // the exact artefact `primed` exists to prevent.
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

  // Folded, because that is what you would do before picking it up: the leaf
  // shut on its frame, carried at a tilt in front of you. Two boxes, like the
  // moving box's preview — this is a preview and not a second piece of
  // furniture, and it exists only while it is off the ground.
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
