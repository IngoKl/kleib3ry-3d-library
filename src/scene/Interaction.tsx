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

/** The same, for a book left open on a table — its own group of meshes. */
function bookIdOf(hit: THREE.Intersection | undefined): string | null {
  let node: THREE.Object3D | null = hit?.object ?? null
  while (node && node.userData.bookId === undefined) node = node.parent
  return (node?.userData.bookId as string | undefined) ?? null
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
      store.setFocusedFixture(null)
      store.setFocusedRecord(null)
      store.setSurfaceTarget(null)
      return
    }

    // Carrying a moving box fills your arms: nothing else is offered, because
    // everything else needs a hand you have not got.
    if (store.carriedBox !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedFixture(null)
      store.setFocusedRecord(null)
      store.setSurfaceTarget(null)
      return
    }

    frame.current += 1
    if (frame.current % 2 !== 0) return

    raycaster.setFromCamera(centre, camera)
    raycaster.far = REACH

    if (store.held === null) {
      store.setShelfTarget(null)
      store.setBoxTarget(null)
      store.setSurfaceTarget(null)

      // Whichever is nearer: a book on a shelf, or one in a box. A book in a
      // box carries that box with it, so looking into a pile offers both the
      // one book (E) and the boxful (G) without having to find the cardboard.
      let best: { distance: number; id: string; inBox?: string } | null = null
      let seat: { distance: number; id: string } | null = null
      let box: { distance: number; id: string } | null = null
      /** A lamp to switch, a deck to start, a coffee maker to fill. */
      let fixture: { distance: number; id: string } | null = null
      let record: { distance: number; id: string } | null = null

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
          const owner = hit.instanceId === undefined ? undefined : sceneRefs.boxedOwners[hit.instanceId]
          best = { distance: hit.distance, id, inBox: owner }
        }
      }

      // Books put down about the room: closed ones are instanced, open ones
      // are their own meshes, and both are picked up exactly like a shelved one.
      const lying = sceneRefs.looseBooks
      if (lying) {
        const hit = raycaster.intersectObject(lying, false)[0]
        const id = hit?.instanceId === undefined ? undefined : sceneRefs.looseIds[hit.instanceId]
        if (hit && id && (!best || hit.distance < best.distance)) {
          best = { distance: hit.distance, id }
        }
      }
      const open = sceneRefs.openBooks
      if (open) {
        const hit = raycaster.intersectObject(open, true)[0]
        const id = bookIdOf(hit)
        if (hit && id && (!best || hit.distance < best.distance)) {
          best = { distance: hit.distance, id }
        }
      }

      const crate = sceneRefs.records
      if (crate) {
        const hit = raycaster.intersectObject(crate, false)[0]
        const id = hit?.instanceId === undefined ? undefined : sceneRefs.recordIds[hit.instanceId]
        if (hit && id) record = { distance: hit.distance, id }
      }

      const operable = sceneRefs.fixtures
      if (operable) {
        const hit = raycaster.intersectObject(operable, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) fixture = { distance: hit.distance, id }
      }

      // A book wins a tie: you are far more often reaching for one than for
      // the chair it happens to be in front of.
      if (seat && (!best || seat.distance < best.distance - 0.15)) {
        store.setFocusedBook(null)
        store.setFocusedSeat(seat.id)
        store.setFocusedBox(null)
        store.setFocusedFixture(null)
        store.setFocusedRecord(null)
      } else {
        store.setFocusedBook(best?.id ?? null)
        store.setFocusedSeat(null)
        // The box holding the book under the crosshair, or — with nothing in
        // the way — the cardboard itself.
        const cardboard = box && (!best || box.distance < best.distance) ? box.id : null
        store.setFocusedBox(best?.inBox ?? cardboard)

        // A record and a lamp are only offered when nothing readable is nearer,
        // so reaching past the crate for a book cannot start the music.
        const nearer = (candidate: { distance: number } | null) =>
          candidate !== null && (!best || candidate.distance < best.distance)
        store.setFocusedRecord(nearer(record) ? record!.id : null)
        store.setFocusedFixture(
          nearer(fixture) && (!record || fixture!.distance < record.distance)
            ? fixture!.id
            : null,
        )
      }
      return
    }

    // Holding a book: aim at somewhere to put it. Cases are instanced per row
    // count, so every group has to be tried and the nearest hit wins.
    store.setFocusedBook(null)
    store.setFocusedSeat(null)
    store.setFocusedBox(null)
    store.setFocusedFixture(null)
    store.setFocusedRecord(null)

    const crates = sceneRefs.boxes
    const boxHit = crates ? raycaster.intersectObject(crates, true)[0] : undefined
    const boxId = furnitureIdOf(boxHit)

    // A table top, which takes a book anywhere on it rather than in a slot.
    const tops = sceneRefs.surfaces
    const topHit = tops ? raycaster.intersectObject(tops, true)[0] : undefined
    const topId = furnitureIdOf(topHit)

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
      store.setSurfaceTarget(null)
      return
    }
    store.setBoxTarget(null)

    // The same for a table: closer than the bookcase behind it means you are
    // putting the book down, not shelving it. Only an upward-facing hit counts
    // — the side of a counter is not somewhere a book can go.
    const upward = topHit?.normal !== undefined && topHit.normal.y > 0.5
    if (topHit && topId && upward && (!nearest || topHit.distance < nearest.distance)) {
      store.setSurfaceTarget({
        furnitureId: topId,
        x: topHit.point.x,
        y: topHit.point.y,
        z: topHit.point.z,
      })
      store.setShelfTarget(null)
      return
    }
    store.setSurfaceTarget(null)

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
