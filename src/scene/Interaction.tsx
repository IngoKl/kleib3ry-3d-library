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
 * The single per-frame raycast that drives everything you can point at. What it
 * offers depends on what is in your hands. It runs at 30 Hz: with a thousand-odd
 * instances this is the most expensive thing in the loop.
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

/** And for a sheet already pinned up. */
function pinIdOf(hit: THREE.Intersection | undefined): string | null {
  let node: THREE.Object3D | null = hit?.object ?? null
  while (node && node.userData.pinId === undefined) node = node.parent
  return (node?.userData.pinId as string | undefined) ?? null
}

/** And for a small prop — a hit on the handle resolves to the cup. */
function propIdOf(hit: THREE.Intersection | undefined): string | null {
  let node: THREE.Object3D | null = hit?.object ?? null
  while (node && node.userData.propId === undefined) node = node.parent
  return (node?.userData.propId as string | undefined) ?? null
}

/** How square-on a surface has to be for a sheet to go on it. */
const UPRIGHT = 0.55

/**
 * Somewhere to stick a sheet, from a hit on a wall or a whiteboard. Only a
 * near-vertical face counts, and the *normal* decides which way the sheet faces
 * — so this works for any wall a document invents.
 */
function pinFrom(hit: THREE.Intersection | undefined): {
  x: number
  y: number
  z: number
  yaw: number
} | null {
  if (!hit || !hit.normal) return null
  // A raycast hands back the normal in the *hit object's* own space. A
  // whiteboard is a turned group, so it must be taken to world space or a sheet
  // pinned to one faces into the plaster.
  const normal = hit.normal.clone().transformDirection(hit.object.matrixWorld)
  if (Math.abs(normal.y) > 1 - UPRIGHT) return null
  return {
    x: hit.point.x,
    y: hit.point.y,
    z: hit.point.z,
    yaw: Math.atan2(normal.x, normal.z),
  }
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
      store.setCrateTarget(null)
      store.setFocusedTape(null)
      store.setTapeCrateTarget(null)
      store.setFocusedShelf(null)
      store.setSurfaceTarget(null)
      store.setPinTarget(null)
      store.setFocusedPin(null)
      store.setBoardTarget(null)
      store.setFocusedProp(null)
      store.setFocusedCat(false)
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
      store.setCrateTarget(null)
      store.setFocusedTape(null)
      store.setTapeCrateTarget(null)
      store.setFocusedShelf(null)
      store.setSurfaceTarget(null)
      store.setPinTarget(null)
      store.setFocusedPin(null)
      store.setBoardTarget(null)
      store.setFocusedProp(null)
      store.setFocusedCat(false)
      return
    }

    frame.current += 1
    if (frame.current % 2 !== 0) return

    raycaster.setFromCamera(centre, camera)
    raycaster.far = REACH

    // Cleared up front rather than in each of the six branches below: with your
    // hands full of a record, a tape, a sheet or a book, the cat is not on
    // offer, and only the empty-handed branch turns it back on.
    store.setFocusedCat(false)

    /**
     * Holding a record: the deck takes it, a crate files it, a table takes it
     * down flat. Nothing else is offered — the sleeve fills the hand a book
     * would need.
     */
    if (store.heldRecord !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedRecord(null)
      store.setFocusedTape(null)
      store.setTapeCrateTarget(null)
      store.setFocusedShelf(null)
      store.setFocusedProp(null)

      const kindOf = (id: string | null) =>
        id ? world.furniture.find((piece) => piece.id === id)?.kind : undefined

      let deck: { distance: number; id: string } | null = null
      const operable = sceneRefs.fixtures
      if (operable) {
        const hit = raycaster.intersectObject(operable, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id && kindOf(id) === 'recordplayer') deck = { distance: hit.distance, id }
      }

      // A crate files it; any other top takes it lying down. Both come off the
      // same hit, because a crate *is* a surface — which is what lets a record
      // player stand on one.
      let crate: { distance: number; id: string } | null = null
      let top: { distance: number; hit: THREE.Intersection; id: string } | null = null
      const tops = sceneRefs.surfaces
      if (tops) {
        const hit = raycaster.intersectObject(tops, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) {
          if (kindOf(id) === 'recordshelf') crate = { distance: hit.distance, id }
          else if (hit.normal !== undefined && hit.normal.y > 0.5) {
            top = { distance: hit.distance, hit, id }
          }
        }
      }
      // The records already in a crate — pointing into a full one should read as
      // "put it back", not as a miss.
      const shelved = sceneRefs.records
      if (shelved) {
        const hit = raycaster.intersectObject(shelved, false)[0]
        const owner =
          hit?.instanceId === undefined ? undefined : sceneRefs.recordCrates[hit.instanceId]
        if (hit && owner && (!crate || hit.distance < crate.distance)) {
          crate = { distance: hit.distance, id: owner }
        }
      }

      store.setFocusedFixture(deck && (!crate || deck.distance < crate.distance) ? deck.id : null)
      store.setCrateTarget(crate && (!deck || crate.distance <= deck.distance) ? crate.id : null)
      store.setSurfaceTarget(
        top && !crate && (!deck || top.distance < deck.distance)
          ? { furnitureId: top.id, x: top.hit.point.x, y: top.hit.point.y, z: top.hit.point.z }
          : null,
      )
      return
    }
    store.setCrateTarget(null)

    /**
     * Holding the marker: whiteboards, and nothing else.
     *
     * The board is not a *target* the way a shelf is — you draw by holding the
     * mouse button and moving your head, which `Drawing.tsx` reads directly. This
     * is only what tells the HUD there is something in front of you to write on,
     * and what `G` wipes.
     */
    if (store.heldMarker !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedRecord(null)
      store.setFocusedTape(null)
      store.setFocusedShelf(null)
      store.setSurfaceTarget(null)
      store.setFocusedFixture(null)
      store.setFocusedPin(null)
      store.setFocusedProp(null)
      // You can be holding a note as well as the marker; a stale target left
      // here would let E pin it somewhere you are no longer looking.
      store.setPinTarget(null)

      const boards = sceneRefs.boards
      const hit = boards ? raycaster.intersectObject(boards, true)[0] : undefined
      store.setBoardTarget(furnitureIdOf(hit))
      return
    }
    store.setBoardTarget(null)

    /**
     * Holding a tape: the television takes it, the crate takes it back. Nothing
     * else is offered, which is the same rule the sleeve in your hand follows —
     * a cassette fills the hand a book would need.
     */
    if (store.heldTape !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedRecord(null)
      store.setFocusedTape(null)
      store.setFocusedShelf(null)
      store.setSurfaceTarget(null)
      store.setFocusedProp(null)

      const kindOf = (id: string | null) =>
        id ? world.furniture.find((piece) => piece.id === id)?.kind : undefined

      let set: { distance: number; id: string } | null = null
      const operable = sceneRefs.fixtures
      if (operable) {
        const hit = raycaster.intersectObject(operable, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id && kindOf(id) === 'crt') set = { distance: hit.distance, id }
      }

      // The crate itself, or the tapes already standing in it — pointing into a
      // full crate should read as "put it back", not as a miss.
      let crate: { distance: number; id: string } | null = null
      const tops = sceneRefs.surfaces
      if (tops) {
        const hit = raycaster.intersectObject(tops, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id && kindOf(id) === 'tapecrate') crate = { distance: hit.distance, id }
      }
      const filed = sceneRefs.tapes
      if (filed) {
        const hit = raycaster.intersectObject(filed, false)[0]
        const owner = hit?.instanceId === undefined ? undefined : sceneRefs.tapeCrates[hit.instanceId]
        if (hit && owner && (!crate || hit.distance < crate.distance)) {
          crate = { distance: hit.distance, id: owner }
        }
      }

      store.setFocusedFixture(set && (!crate || set.distance < crate.distance) ? set.id : null)
      store.setTapeCrateTarget(crate && (!set || crate.distance <= set.distance) ? crate.id : null)
      return
    }
    store.setTapeCrateTarget(null)

    /**
     * Holding a cartridge: the arcade machine takes it, the ROM box takes it
     * back or swaps it for the next one. Both are fixtures, so one hit answers
     * for either and E asks the kind.
     */
    if (store.heldRom !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedSeat(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedRecord(null)
      store.setFocusedTape(null)
      store.setFocusedShelf(null)
      store.setSurfaceTarget(null)
      store.setFocusedProp(null)
      store.setPinTarget(null)
      store.setFocusedPin(null)

      const kindOf = (id: string | null) =>
        id ? world.furniture.find((piece) => piece.id === id)?.kind : undefined

      const operable = sceneRefs.fixtures
      const hit = operable ? raycaster.intersectObject(operable, true)[0] : undefined
      const id = furnitureIdOf(hit)
      const kind = kindOf(id)
      store.setFocusedFixture(id && (kind === 'arcade' || kind === 'rombox') ? id : null)
      return
    }

    /**
     * Holding a cup, a can or a takeaway box: somewhere to set it down, the
     * bin, and — with the empty cup — the machine that refills it. A chair
     * still takes you: sitting down with the coffee is what the coffee is for.
     */
    if (store.heldProp !== null) {
      store.setFocusedBook(null)
      store.setShelfTarget(null)
      store.setFocusedBox(null)
      store.setBoxTarget(null)
      store.setFocusedRecord(null)
      store.setFocusedTape(null)
      store.setFocusedShelf(null)
      store.setFocusedPin(null)
      store.setPinTarget(null)
      store.setFocusedProp(null)

      const kindOf = (id: string | null) =>
        id ? world.furniture.find((piece) => piece.id === id)?.kind : undefined

      let fixture: { distance: number; id: string } | null = null
      const operable = sceneRefs.fixtures
      if (operable) {
        const hit = raycaster.intersectObject(operable, true)[0]
        const id = furnitureIdOf(hit)
        const kind = kindOf(id)
        // Only the *empty* cup wants the machine: aiming a full one at it
        // falls through to the counter, which is where a full cup goes. The
        // door answers too — carrying the takeaway in through a shut door
        // must not need a free hand.
        const wants =
          kind === 'bin' ||
          kind === 'door' ||
          (kind === 'coffeemaker' && store.heldProp.kind === 'cup' && !store.heldProp.full)
        if (hit && id && wants) fixture = { distance: hit.distance, id }
      }

      let seat: { distance: number; id: string } | null = null
      const seats = sceneRefs.seats
      if (seats && store.seat === null) {
        const hit = raycaster.intersectObject(seats, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) seat = { distance: hit.distance, id }
      }

      let top: { distance: number; hit: THREE.Intersection; id: string } | null = null
      const tops = sceneRefs.surfaces
      if (tops) {
        const hit = raycaster.intersectObject(tops, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id && hit.normal !== undefined && hit.normal.y > 0.5) {
          top = { distance: hit.distance, hit, id }
        }
      }

      const wins = (
        candidate: { distance: number } | null,
        others: ({ distance: number } | null)[],
      ) =>
        candidate !== null &&
        others.every((other) => other === null || candidate.distance <= other.distance)

      store.setFocusedFixture(wins(fixture, [seat, top]) ? fixture!.id : null)
      store.setFocusedSeat(wins(seat, [fixture, top]) ? seat!.id : null)
      store.setSurfaceTarget(
        wins(top, [fixture, seat])
          ? { furnitureId: top!.id, x: top!.hit.point.x, y: top!.hit.point.y, z: top!.hit.point.z }
          : null,
      )
      return
    }

    /**
     * Holding a sheet: somewhere to put it, and nothing else.
     *
     * Walls, whiteboards, *and* the sheets already up — pointing at a page on the
     * board and pressing E should put yours next to it rather than reading as a
     * miss, so a hit on a pinned sheet is offered as a place on the surface just
     * behind it.
     */
    if (store.heldPin !== null) {
      store.setFocusedPin(null)
      store.setFocusedProp(null)

      const candidates: THREE.Intersection[] = []
      const boards = sceneRefs.boards
      if (boards) {
        const hit = raycaster.intersectObject(boards, true)[0]
        if (hit) candidates.push(hit)
      }
      // The room shells are merged per material, so a hit could be a floor or a
      // rafter; only the plaster is marked as a wall.
      const shells = sceneRefs.walls
      if (shells) {
        const hit = raycaster.intersectObject(shells, true)[0]
        if (hit && hit.object.userData.wall !== undefined) candidates.push(hit)
      }

      candidates.sort((a, b) => a.distance - b.distance)
      store.setPinTarget(candidates.map(pinFrom).find((spot) => spot !== null) ?? null)
      return
    }
    store.setPinTarget(null)

    // A sheet already up, which E takes back down. Offered before the bookcase
    // behind it, and before any book: a page on a wall is unambiguous.
    const up = sceneRefs.pinned
    let sheet: { distance: number; id: string } | null = null
    if (up) {
      const hit = raycaster.intersectObject(up, true)[0]
      const id = pinIdOf(hit)
      if (hit && id) sheet = { distance: hit.distance, id }
    }

    // The nearest bookcase carcass, held book or not: this is what `L` labels
    // when there is no book to go by — an empty case is still worth writing on.
    let carcass: { distance: number; id: string } | null = null
    for (const group of sceneRefs.shelfGroups) {
      if (!group.mesh) continue
      const hit = raycaster.intersectObject(group.mesh, false)[0]
      if (!hit || hit.instanceId === undefined) continue
      const index = group.indices[hit.instanceId]
      const id = index === undefined ? undefined : world.shelves[index]?.id
      if (id && (!carcass || hit.distance < carcass.distance)) {
        carcass = { distance: hit.distance, id }
      }
    }
    store.setFocusedShelf(carcass?.id ?? null)

    if (store.held === null) {
      store.setShelfTarget(null)
      store.setBoxTarget(null)
      store.setSurfaceTarget(null)

      // The cat, if it is nearer than anything else. Not offered while you are
      // sitting, for the same reason a chair is not: `E` from a seat means stand up.
      let animal: { distance: number } | null = null
      const pet = store.seat === null ? sceneRefs.cat : null
      if (pet) {
        const hit = raycaster.intersectObject(pet, true)[0]
        if (hit) {
          // …and only if there is no wall in the way. Nothing else here tests
          // for an occluder, because nothing else moves into the next room on
          // its own.
          const shells = sceneRefs.walls
          const wall = shells ? raycaster.intersectObject(shells, true)[0] : undefined
          if (!wall || wall.distance > hit.distance) animal = { distance: hit.distance }
        }
      }

      // Whichever is nearer: a book on a shelf, or one in a box. A book in a
      // box carries that box with it, so looking into a pile offers both the
      // one book (E) and the boxful (G) without having to find the cardboard.
      let best: { distance: number; id: string; inBox?: string } | null = null
      let seat: { distance: number; id: string } | null = null
      let box: { distance: number; id: string } | null = null
      /** A lamp to switch, a deck to start, a coffee maker to fill. */
      let fixture: { distance: number; id: string } | null = null
      let record: { distance: number; id: string } | null = null
      let tape: { distance: number; id: string } | null = null

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

      const box_ = sceneRefs.tapes
      if (box_) {
        const hit = raycaster.intersectObject(box_, false)[0]
        const id = hit?.instanceId === undefined ? undefined : sceneRefs.tapeIds[hit.instanceId]
        if (hit && id) tape = { distance: hit.distance, id }
      }

      const operable = sceneRefs.fixtures
      if (operable) {
        const hit = raycaster.intersectObject(operable, true)[0]
        const id = furnitureIdOf(hit)
        if (hit && id) fixture = { distance: hit.distance, id }
      }

      // A cup, can or box standing about the room, to pick back up.
      let prop: { distance: number; id: string } | null = null
      const smalls = sceneRefs.props
      if (smalls) {
        const hit = raycaster.intersectObject(smalls, true)[0]
        const id = propIdOf(hit)
        if (hit && id) prop = { distance: hit.distance, id }
      }

      // Wearing the headlamp, a bare tabletop offers to take it off your head
      // — the one empty-handed use the crosshair has for a surface.
      let rest: { distance: number; hit: THREE.Intersection; id: string } | null = null
      if (store.wornLamp !== null) {
        const tops = sceneRefs.surfaces
        const hit = tops ? raycaster.intersectObject(tops, true)[0] : undefined
        const id = furnitureIdOf(hit)
        if (hit && id && hit.normal !== undefined && hit.normal.y > 0.5) {
          rest = { distance: hit.distance, hit, id }
        }
      }

      // The cat, if it is genuinely the thing in front of you. It goes first
      // because it is the only candidate that moves on its own, and reaching
      // past a cat for the book behind it is a thing you can do by waiting.
      const catAt = animal?.distance ?? Infinity
      if (
        Number.isFinite(catAt) &&
        [best, seat, box, fixture, record, tape, sheet, prop].every(
          (other) => other === null || catAt < other.distance,
        )
      ) {
        store.setFocusedCat(true)
        store.setFocusedBook(null)
        store.setFocusedSeat(null)
        store.setFocusedBox(null)
        store.setFocusedFixture(null)
        store.setFocusedRecord(null)
        store.setFocusedTape(null)
        store.setFocusedPin(null)
        store.setFocusedProp(null)
        return
      }

      // A sheet on the wall wins outright when it is the nearest thing: nothing
      // else lives on a wall, so there is nothing for it to be confused with.
      if (sheet && (!best || sheet.distance < best.distance)) {
        store.setFocusedPin(sheet.id)
        store.setFocusedBook(null)
        store.setFocusedSeat(null)
        store.setFocusedBox(null)
        store.setFocusedFixture(null)
        store.setFocusedRecord(null)
        store.setFocusedTape(null)
        store.setFocusedProp(null)
        return
      }
      store.setFocusedPin(null)

      // A book wins a tie: you are far more often reaching for one than for
      // the chair it happens to be in front of.
      if (seat && (!best || seat.distance < best.distance - 0.15)) {
        store.setFocusedBook(null)
        store.setFocusedSeat(seat.id)
        store.setFocusedBox(null)
        store.setFocusedFixture(null)
        store.setFocusedRecord(null)
        store.setFocusedTape(null)
        store.setFocusedProp(null)
      } else {
        store.setFocusedBook(best?.id ?? null)
        store.setFocusedSeat(null)
        // The box holding the book under the crosshair, or — with nothing in
        // the way — the cardboard itself.
        const cardboard = box && (!best || box.distance < best.distance) ? box.id : null
        store.setFocusedBox(best?.inBox ?? cardboard)

        // A record, a tape, a lamp and a prop are only offered when nothing
        // readable is nearer, so reaching past a crate for a book cannot start
        // the music. They exclude each other symmetrically: guarding only one
        // hands E to whatever is behind it.
        const nearer = (candidate: { distance: number } | null) =>
          candidate !== null && (!best || candidate.distance < best.distance)
        const closest = (candidate: { distance: number } | null, others: ({ distance: number } | null)[]) =>
          nearer(candidate) &&
          others.every((other) => other === null || candidate!.distance < other.distance)

        store.setFocusedRecord(closest(record, [fixture, tape, prop]) ? record!.id : null)
        store.setFocusedTape(closest(tape, [fixture, record, prop]) ? tape!.id : null)
        store.setFocusedFixture(closest(fixture, [record, tape, prop]) ? fixture!.id : null)
        store.setFocusedProp(closest(prop, [fixture, record, tape]) ? prop!.id : null)

        // The tabletop takes the headlamp only when nothing else is nearer —
        // everything on the table beats the table.
        store.setSurfaceTarget(
          rest &&
            [best, box, fixture, record, tape, prop].every(
              (other) => other === null || rest!.distance <= other.distance,
            )
            ? {
                furnitureId: rest.id,
                x: rest.hit.point.x,
                y: rest.hit.point.y,
                z: rest.hit.point.z,
              }
            : null,
        )
      }
      return
    }

    // Holding a book: aim at somewhere to put it. Cases are instanced per row
    // count, so every group has to be tried and the nearest hit wins.
    store.setFocusedBook(null)
    store.setFocusedBox(null)
    store.setFocusedFixture(null)
    store.setFocusedRecord(null)
    store.setFocusedTape(null)
    store.setFocusedPin(null)
    store.setFocusedProp(null)

    // A chair still takes you with your hands full: sitting down with the book
    // you mean to read is what the chair is for.
    let chair: { distance: number; id: string; hit: THREE.Intersection } | null = null
    const sittable = sceneRefs.seats
    if (sittable && store.seat === null) {
      const hit = raycaster.intersectObject(sittable, true)[0]
      const id = furnitureIdOf(hit)
      if (hit && id) chair = { distance: hit.distance, id, hit }
    }

    // A bench or a bed is both a seat and a surface, and it renders once, in
    // the seats group — so its surface half is read off the *seat* hit: aimed
    // at the top, the book is laid down; aimed at the side, you sit.
    let seatTop: { distance: number; hit: THREE.Intersection; id: string } | null = null
    if (chair) {
      const seatId = chair.id
      const piece = world.furniture.find((item) => item.id === seatId)
      if (piece?.surface && chair.hit.normal !== undefined && chair.hit.normal.y > 0.5) {
        seatTop = chair
        chair = null
      }
    }

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

    // The chair, if it is plainly what you are aiming at. A bench is also a
    // surface, and on a tie the surface wins — a book laid on a bench beats
    // sitting on it with the book still in hand.
    if (
      chair &&
      (!boxHit || chair.distance < boxHit.distance) &&
      (!topHit || chair.distance < topHit.distance) &&
      (!nearest || chair.distance < nearest.distance)
    ) {
      store.setFocusedSeat(chair.id)
      store.setBoxTarget(null)
      store.setSurfaceTarget(null)
      store.setShelfTarget(null)
      return
    }
    store.setFocusedSeat(null)

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
    let top =
      topHit && topId && upward ? { distance: topHit.distance, hit: topHit, id: topId } : null
    if (seatTop && (!top || seatTop.distance < top.distance)) top = seatTop
    if (top && (!nearest || top.distance < nearest.distance)) {
      store.setSurfaceTarget({
        furnitureId: top.id,
        x: top.hit.point.x,
        y: top.hit.point.y,
        z: top.hit.point.z,
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
