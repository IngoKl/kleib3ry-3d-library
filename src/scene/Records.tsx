import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { approach } from '../lib/ease'
import { hashId } from '../data/dimensions'
import {
  ASSIGNABLE_SLOTS,
  FIRST_ASSIGNABLE,
  makeSleeveAtlas,
  makeSleeveGeometry,
  makeSleeveMaterial,
  sleeveArtFor,
  SLEEVE_SIZE,
  SLEEVE_THICKNESS,
  type SleeveArt,
} from './recordAtlas'
import { useLibraryStore } from '../state/library'
import { useMediaStore } from '../state/media'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * The records: filed in the crates, or lying wherever you left one.
 *
 * Records are *dealt* rather than arranged. Every crate takes a slice of the
 * music folder in its own order, so adding a file to `music/` puts it on the
 * shelf and nothing has to be written down for a few hundred sleeves to have
 * somewhere to be. What is written down is only what you have had an opinion
 * about: a record carried to another crate stays in that crate, and a record set
 * down on a table stays on the table. Both live in `books.json` beside the book
 * layout — see `state/library.ts` — and both are one entry rather than an
 * ordering, because unlike a shelf a crate has no order worth keeping.
 *
 * One instanced mesh for the lot, filed and loose together, printed from a
 * sleeve atlas the same way the books are printed from the spine atlas.
 */

const SLEEVE = SLEEVE_SIZE
const THICKNESS = SLEEVE_THICKNESS
/** How much air is left between two filed sleeves. */
const GAP = 0.0035
const LEAN_AXIS = new THREE.Vector3(1, 0, 0)

/**
 * A crate has a centre divider, so records file into two bays either side of
 * it rather than through it — which also stops a full crate reading as one
 * solid slab.
 */
const BAY_X = 0.215

type Filed = {
  id: string
  /** The crate it is filed in, or null for one lying about the room. */
  crate: string | null
  x: number
  y: number
  z: number
  rotationY: number
  /** Radians of lean back against the crate, varied so a bay is not a slab. */
  lean: number
  /** True for a record set down on a surface: sleeve flat, face up. */
  flat: boolean
  art: SleeveArt
}

export function Records() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const tracks = useMediaStore((s) => s.tracks)
  // Subscribed rather than peeked: the record on the deck and the one in your
  // hand are out of their crate, and their instances have to follow suit the
  // moment either changes — not the next time the crosshair happens to move.
  const playing = useMediaStore((s) => s.playing)
  const heldRecord = useAppStore((s) => s.heldRecord)
  const filedRecords = useLibraryStore((s) => s.filedRecords)
  const looseRecords = useLibraryStore((s) => s.looseRecords)

  /**
   * Deal the collection into whatever crates the room has, in document order,
   * and put the ones you have moved where you put them.
   *
   * A record you filed by hand claims its crate first; the rest fill whatever is
   * left, in folder order. That ordering matters: without it, a record filed into
   * a full crate would be pushed straight back out by the deal, and putting one
   * away would look like it had not gone in.
   */
  const filed = useMemo<Filed[]>(() => {
    if (!world || tracks.length === 0) return []
    const crates = world.furniture.filter((item) => item.kind === 'recordshelf')

    const out: Filed[] = []
    const placed = new Set<string>()

    // Records lying on tables and counters. Face up, turned the way you were
    // standing, resting a hair above whatever they were set down on.
    for (const track of tracks) {
      const at = looseRecords[track.id]
      if (!at) continue
      placed.add(track.id)
      out.push({
        id: track.id,
        crate: null,
        x: at.x,
        y: at.y,
        z: at.z,
        rotationY: at.yaw,
        lean: 0,
        flat: true,
        art: sleeveArtFor(track),
      })
    }

    const known = new Set(crates.map((crate) => crate.id))
    // A crate that has gone out of `library.json` cannot hold anything, so its
    // records rejoin the deal rather than disappearing.
    const wanted = (crateId: string) =>
      tracks.filter((track) => !placed.has(track.id) && filedRecords[track.id] === crateId)
    const pool = tracks.filter(
      (track) =>
        !placed.has(track.id) &&
        !(filedRecords[track.id] !== undefined && known.has(filedRecords[track.id]!)),
    )
    let cursor = 0

    for (const crate of crates) {
      // Records lean back against the divider, filling each bay front to back.
      const usable = crate.depth - 0.09
      const perBay = Math.max(1, Math.floor(usable / (THICKNESS + GAP)))
      const cos = Math.cos(crate.rotationY)
      const sin = Math.sin(crate.rotationY)

      const queue = wanted(crate.id)
      for (let slot = 0; slot < perBay * 2; slot++) {
        const track = queue.shift() ?? pool[cursor++]
        if (!track) break

        const bay = slot < perBay ? -1 : 1
        const localX = bay * BAY_X
        const localZ = usable / 2 - (slot % perBay) * (THICKNESS + GAP)
        const hash = hashId(track.id)

        out.push({
          id: track.id,
          crate: crate.id,
          x: crate.x + localX * cos + localZ * sin,
          y: crate.y + 0.08 + SLEEVE / 2,
          z: crate.z - localX * sin + localZ * cos,
          rotationY: crate.rotationY,
          lean: -0.045 - (hash % 7) * 0.007,
          flat: false,
          art: sleeveArtFor(track),
        })
      }
    }

    return out
  }, [world, tracks, filedRecords, looseRecords])

  const capacity = useMemo(() => Math.max(32, Math.ceil((filed.length + 8) / 32) * 32), [
    Math.ceil((filed.length + 8) / 32),
  ])

  const atlas = useMemo(() => makeSleeveAtlas(), [])
  const geometry = useMemo(() => makeSleeveGeometry(), [])
  const material = useMemo(() => makeSleeveMaterial(atlas), [atlas])
  useEffect(
    () => () => {
      atlas.dispose()
      geometry.dispose()
      material.dispose()
    },
    [atlas, geometry, material],
  )

  /** How far each sleeve is drawn up out of the crate, 0 to 1. */
  const lift = useRef<Float32Array>(new Float32Array(0))

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      leanTurn: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const item = filed[i]
    const { matrix, position, quaternion, leanTurn, scale, colour, hidden, up } = scratch
    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    // A record on the deck, or in your hand, is not in the crate.
    const away =
      useMediaStore.getState().playing === item.id ||
      useAppStore.getState().heldRecord === item.id
    position.set(item.x, item.y + amount * 0.07, item.z)
    quaternion.setFromAxisAngle(up, item.rotationY)
    // A filed record stands and leans back; one set down lies on its face, which
    // is the same sleeve tipped a quarter turn onto its back.
    quaternion.multiply(leanTurn.setFromAxisAngle(LEAN_AXIS, item.flat ? -Math.PI / 2 : item.lean))
    scale.set(SLEEVE, SLEEVE, THICKNESS)
    matrix.compose(position, quaternion, away ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    // White lets the atlas art through untinted; the focused sleeve lifts and
    // brightens a little, which reads as the hand it is about to be in.
    colour.setScalar(1 + amount * 0.22)
    mesh.setColorAt(i, colour)
  }

  // Print the sleeves. No recycling: a crate holds dozens, the grid holds 143,
  // and anything past the grid stays plain card rather than stealing a cell.
  useLayoutEffect(() => {
    // Update the attribute in place when the capacity allows: a replaced
    // attribute's GPU buffer is only freed on geometry dispose, so swapping in
    // a fresh one per world edit accumulated orphaned buffers.
    let rects = geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute | undefined
    if (!rects || rects.count !== capacity) {
      rects = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
      geometry.setAttribute('aUvRect', rects)
    }
    const uvRect = rects.array as Float32Array
    for (let i = 0; i < capacity; i++) {
      const item = filed[i]
      const slot = item && i < ASSIGNABLE_SLOTS ? FIRST_ASSIGNABLE + i : null
      if (item && slot !== null) atlas.draw(slot, item.art)
      const rect = slot !== null ? atlas.rect(slot) : atlas.blank
      uvRect.set(rect, i * 4)
    }
    atlas.commit()
    rects.needsUpdate = true
  }, [capacity, filed, atlas, geometry])

  /** The records the lift values were dealt to; a re-deal invalidates them. */
  const liftOwner = useRef<unknown>(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    if (lift.current.length !== capacity || liftOwner.current !== filed) {
      // Reset on a re-deal even at the same capacity: a sleeve mid-lift would
      // otherwise leave its value on an index that now belongs to a different
      // record.
      lift.current = new Float32Array(capacity)
      liftOwner.current = filed
    }
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.records = mesh
    sceneRefs.recordIds = filed.map((item) => item.id)
    sceneRefs.recordCrates = filed.map((item) => item.crate)
    return () => {
      sceneRefs.records = null
      sceneRefs.recordIds = []
      sceneRefs.recordCrates = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, filed, playing, heldRecord])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || filed.length === 0) return
    const focused = useAppStore.getState().focusedRecord
    const rate = approach(10, delta)
    let dirty = false

    for (let i = 0; i < filed.length; i++) {
      const want = filed[i]!.id === focused ? 1 : 0
      const current = lift.current[i] ?? 0
      if (Math.abs(want - current) < 0.001) {
        if (current !== want) {
          lift.current[i] = want
          write(mesh, i)
          dirty = true
        }
        continue
      }
      lift.current[i] = current + (want - current) * rate
      write(mesh, i)
      dirty = true
    }

    if (dirty) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      key={capacity}
      ref={meshRef}
      args={[geometry, material, capacity]}
      castShadow
      receiveShadow
    />
  )
}
