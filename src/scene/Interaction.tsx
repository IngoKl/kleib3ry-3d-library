import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { useShelfTransforms } from './transforms'
import { insertionIndex } from './shelving'
import { rowFromLocalY } from '../world/shelf'
import { packedRow } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/** How far the crosshair reaches, in metres. */
const REACH = 2.6

/**
 * The single per-frame raycast that drives everything you can point at.
 *
 * Empty-handed it looks for a book, on a shelf or in a box, or for something to
 * sit in or unpack; holding one it looks for a place to put it, a shelf or a
 * box. Both run at 30 Hz — with a thousand-odd instances this is the most
 * expensive thing in the loop, and a crosshair does not need more.
 */

/** Furniture id off a hit anywhere in a piece's several meshes. */
function furnitureIdOf(hit: THREE.Intersection | undefined): string | null {
  let node: THREE.Object3D | null = hit?.object ?? null
  while (node && node.userData.furnitureId === undefined) node = node.parent
  return (node?.userData.furnitureId as string | undefined) ?? null
}
export function Interaction() {
  const camera = useThree((s) => s.camera)
  const mode = useAppStore((s) => s.mode)
  const world = useWorldStore((s) => s.world)
  const transforms = useShelfTransforms()

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const centre = useMemo(() => new THREE.Vector2(0, 0), [])
  const local = useMemo(() => new THREE.Vector3(), [])
  const inverse = useMemo(() => new THREE.Matrix4(), [])
  const frame = useRef(0)

  useFrame(() => {
    const store = useAppStore.getState()

    if (mode !== 'walk' || !world) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      return
    }

    frame.current += 1
    if (frame.current % 2 !== 0) return

    raycaster.setFromCamera(centre, camera)
    raycaster.far = REACH

    if (store.held === null) {
      store.setShelfTarget(null)
      store.setBoxTarget(null)

      // Whichever is nearer: a book on a shelf, or one in a box.
      let best: { distance: number; id: string } | null = null
      let seat: { distance: number; id: string } | null = null
      let box: { distance: number; id: string } | null = null

      // A chair, if one is nearer than whatever book is behind it. Recursive,
      // because a chair is a handful of meshes under one group.
      const seats = sceneRefs.seats
      if (seats && store.seat === null) {
        const hit = raycaster.intersectObject(seats, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) seat = { distance: hit.distance, id }
      }

      // The box itself, for unpacking it. Its own books are in front of the
      // cardboard, so pointing into a full box finds a book first.
      const crates = sceneRefs.boxes
      if (crates && store.seat === null) {
        const hit = raycaster.intersectObject(crates, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) box = { distance: hit.distance, id }
      }

      const shelved = sceneRefs.books
      if (shelved) {
        const hit = raycaster.intersectObject(shelved, false)[0]
        const id = hit?.instanceId === undefined ? undefined : sceneRefs.bookIds[hit.instanceId]
        if (hit && id) best = { distance: hit.distance, id }
      }

      const inBoxes = sceneRefs.boxedBooks
      if (inBoxes) {
        const hit = raycaster.intersectObject(inBoxes, false)[0]
        const id = hit?.instanceId === undefined ? undefined : sceneRefs.boxedIds[hit.instanceId]
        if (hit && id && (!best || hit.distance < best.distance)) {
          best = { distance: hit.distance, id }
        }
      }

      // A book wins a tie: you are far more often reaching for one than for
      // the chair it happens to be in front of.
      if (seat && (!best || seat.distance < best.distance - 0.15)) {
        store.setFocusedBook(null)
        store.setFocusedSeat(seat.id)
        store.setFocusedBox(null)
      } else {
        store.setFocusedBook(best?.id ?? null)
        store.setFocusedSeat(null)
        // The box only offers itself when nothing in it is under the crosshair,
        // so reaching for one book cannot turn into emptying the whole box.
        store.setFocusedBox(box && (!best || box.distance < best.distance) ? box.id : null)
      }
      return
    }

    // Holding a book: aim at somewhere to put it. Cases are instanced per row
    // count, so every group has to be tried and the nearest hit wins.
    store.setFocusedBook(null)
    store.setFocusedSeat(null)
    store.setFocusedBox(null)

    const crates = sceneRefs.boxes
    const boxHit = crates ? raycaster.intersectObject(crates, true)[0] : undefined
    const boxId = furnitureIdOf(boxHit)

    let nearest: { distance: number; shelf: number; point: THREE.Vector3 } | null = null
    for (const group of sceneRefs.shelfGroups) {
      if (!group.mesh) continue
      const hit = raycaster.intersectObject(group.mesh, false)[0]
      if (!hit || hit.instanceId === undefined) continue
      const shelf = group.indices[hit.instanceId]
      if (shelf === undefined) continue
      if (!nearest || hit.distance < nearest.distance) {
        nearest = { distance: hit.distance, shelf, point: hit.point }
      }
    }

    // A box in front of a bookcase takes the book: you are looking down into
    // it, and the case behind is not what you are aiming at.
    if (boxHit && boxId && (!nearest || boxHit.distance < nearest.distance)) {
      store.setBoxTarget(boxId)
      store.setShelfTarget(null)
      return
    }
    store.setBoxTarget(null)

    const transform = nearest ? transforms[nearest.shelf] : undefined
    const shelf = nearest ? world.shelves[nearest.shelf] : undefined
    if (!nearest || !transform || !shelf) {
      store.setShelfTarget(null)
      return
    }

    // Back into the unit's own frame so row and slot are simple comparisons.
    inverse.copy(transform.matrix).invert()
    local.copy(nearest.point).applyMatrix4(inverse)

    const row = rowFromLocalY(local.y, shelf.rows)
    if (row === null) {
      store.setShelfTarget(null)
      return
    }

    store.setShelfTarget({
      shelf: nearest.shelf,
      shelfId: shelf.id,
      row,
      localX: local.x,
      index: insertionIndex(packedRow(nearest.shelf, row), local.x),
    })
  })

  return null
}
