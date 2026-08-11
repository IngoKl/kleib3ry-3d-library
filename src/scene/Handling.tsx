import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { supportAt } from '../world/derive'
import { launchBody, throwFrom } from './drop'
import { useAppStore } from '../state/store'
import { useLibraryStore } from '../state/library'
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
 *   X  pick a moving box up and carry it, or set it down again
 *
 * `E` is still the walk controller's, because it is the same reach that takes a
 * book off a shelf and it belongs next to that.
 */

/** How far in front of you a carried box floats, and how far below your eyes. */
const CARRY_AHEAD = 0.72
const CARRY_DROP = 0.58

export function Handling() {
  const carried = useAppStore((s) => s.carriedBox)
  const world = useWorldStore((s) => s.world)
  const ghost = useRef<THREE.Group>(null)

  const box = world?.furniture.find((item) => item.id === carried)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const app = useAppStore.getState()
      if (app.labelling !== null || app.mode !== 'walk') return
      const shelf = useLibraryStore.getState()
      const live = useWorldStore.getState().world

      if (e.code === 'KeyQ') {
        e.preventDefault()
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
          yaw: player.yaw + Math.PI,
          open: true,
          spread,
        })
        app.setHeld(null)
        return
      }

      if (e.code === 'KeyL') {
        e.preventDefault()
        // Label the case you are aiming at. Holding a book that is the shelf
        // position under the crosshair; empty-handed it is whichever case the
        // book under the crosshair is standing in.
        const shelfId =
          app.shelfTarget?.shelfId ??
          shelf.packed.find((item) => item.id === app.focusedBook)?.shelfId
        if (shelfId) app.setLabelling(shelfId)
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
      const piece = live?.furniture.find((item) => item.id === id)
      const room = live?.rooms.find((candidate) => candidate.id === piece?.roomId)
      app.setCarriedBox(null)
      if (!piece || !room) return

      const x = player.x - Math.sin(player.yaw) * CARRY_AHEAD
      const z = player.z - Math.cos(player.yaw) * CARRY_AHEAD
      // Stored room-local, because that is the frame the document is written
      // in: a box recorded in world metres would jump the first time somebody
      // moved the room it belongs to.
      useLibraryStore
        .getState()
        .moveFurniture(id, [x - room.origin[0], z - room.origin[1]], (player.yaw * 180) / Math.PI)
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
