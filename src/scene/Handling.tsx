import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FURNITURE_SIZE, supportAt } from '../world/derive'
import { launchBody, throwFrom } from './drop'
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
 *   X  pick a moving box up and carry it, or set it down again
 *   Backspace  break down the empty box you are looking at
 *
 * `E` is still the walk controller's, because it is the same reach that takes a
 * book off a shelf and it belongs next to that — and pinning a sheet to a wall
 * is that same reach.
 */

/** How far in front of you a carried box floats, and how far below your eyes. */
const CARRY_AHEAD = 0.72
const CARRY_DROP = 0.58

export function Handling() {
  const carried = useAppStore((s) => s.carriedBox)
  const world = useWorldStore((s) => s.world)
  const ghost = useRef<THREE.Group>(null)

  // A box off the stack has no furniture entry yet; it previews at the kind's
  // own size, which is the size it will be when it lands.
  const box =
    carried === NEW_BOX
      ? { width: FURNITURE_SIZE.box.width, height: FURNITURE_SIZE.box.height, depth: FURNITURE_SIZE.box.depth }
      : world?.furniture.find((item) => item.id === carried)

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
        // A sheet you have decided against is screwed up and thrown away. Only
        // when your hands are otherwise empty, because with a book in one hand
        // Q plainly means the book.
        if (app.heldPin && !app.held) {
          app.setHeldPin(null)
          return
        }
        // Drop it. Somewhere in front of you, and then wherever it rolls to —
        // the one thing in the room that is not where you put it.
        if (!app.held) return
        const size = shelf.dims.get(app.held)
        if (!size) return
        const body = throwFrom(player, size, false)
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
        if (app.carriedBox) {
          setDown(app.carriedBox)
          return
        }
        // Only with your hands free: a box needs both, and a book in one of
        // them is exactly the thing you would put down first.
        if (app.held === null && app.focusedBox) app.setCarriedBox(app.focusedBox)
        return
      }

      if (e.code === 'Backspace') {
        // Break down the empty box under the crosshair. Its own key, and one
        // with "delete" written into it: G on the same box shelves a boxful,
        // and the two must not sit on neighbouring meanings of one key.
        // `deleteBox` refuses a box with books in it.
        if (app.held === null && app.carriedBox === null && app.focusedBox) {
          e.preventDefault()
          shelf.deleteBox(app.focusedBox)
        }
      }
    }

    /**
     * Put the box down where you are standing.
     *
     * Committed once, here, rather than every frame while it is carried:
     * moving furniture re-derives the whole world and re-reconciles the
     * library, which is the right thing to do for an edit and quite the wrong
     * thing to do at sixty hertz.
     */
    const setDown = (id: string) => {
      const app = useAppStore.getState()
      const live = useWorldStore.getState().world
      app.setCarriedBox(null)

      const x = player.x - Math.sin(player.yaw) * CARRY_AHEAD
      const z = player.z - Math.cos(player.yaw) * CARRY_AHEAD
      // Snapped to a quarter turn: the collision AABBs assume right-angle
      // rotations (see `aabbFromCentre`), and a box set down at 45° would
      // render rotated while colliding axis-aligned.
      const facing = Math.round((player.yaw * 180) / Math.PI / 90) * 90

      // A box fresh off the stack becomes real furniture here, where it first
      // touches the floor.
      if (id === NEW_BOX) {
        useLibraryStore.getState().spawnBox(x, z, facing, player.floor)
        return
      }

      const piece = live?.furniture.find((item) => item.id === id)
      const room = live?.rooms.find((candidate) => candidate.id === piece?.roomId)
      if (!piece || !room) return

      // Stored room-local, because that is the frame the document is written
      // in: a box recorded in world metres would jump the first time somebody
      // moved the room it belongs to. The elevation rides along because the
      // document room only knows its own storey — a box carried up to the
      // loft used to derive at ground level, inside the loft floor.
      useLibraryStore
        .getState()
        .moveFurniture(id, [x - room.origin[0], z - room.origin[1]], facing, player.floor)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The carried box rides in front of you. Only a preview: the real one is
  // still standing where it was until you set this one down.
  useFrame(() => {
    const node = ghost.current
    if (!node || !box) return
    node.position.set(
      player.x - Math.sin(player.yaw) * CARRY_AHEAD,
      player.eye - CARRY_DROP,
      player.z - Math.cos(player.yaw) * CARRY_AHEAD,
    )
    node.rotation.y = player.yaw
  })

  if (!box) return null

  return (
    <group ref={ghost}>
      <mesh castShadow>
        <boxGeometry args={[box.width, box.height, box.depth]} />
        <meshStandardMaterial color="#b9915f" roughness={1} />
      </mesh>
      <mesh position={[0, box.height / 2 + 0.002, 0]}>
        <boxGeometry args={[box.width * 0.96, 0.006, box.depth * 0.96]} />
        <meshStandardMaterial color="#a07a4b" roughness={1} />
      </mesh>
    </group>
  )
}
