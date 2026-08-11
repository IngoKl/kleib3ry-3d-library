import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { hashId } from '../data/dimensions'
import {
  ASSIGNABLE_SLOTS,
  FIRST_ASSIGNABLE,
  makeSleeveAtlas,
  makeSleeveGeometry,
  makeSleeveMaterial,
  sleeveArtFor,
  type SleeveArt,
} from './recordAtlas'
import { useMediaStore } from '../state/media'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * The records, filed in the crates.
 *
 * Unlike books, records are *not* arranged by hand. A book's place on a shelf
 * is a decision worth storing — a record is one of a few hundred, filed in the
 * order the folder is in, and inventing a second layout document so you could
 * alphabetise your sleeves would be a lot of machinery for something nobody
 * asked for. So: every crate in the world takes a slice of the music folder, in
 * order, and adding a file to `music/` puts it on the shelf. It also means a
 * record taken out has a place to go back to without anything being written
 * down — filing one is just letting go of it.
 *
 * One instanced mesh for the lot, printed from a sleeve atlas the same way the
 * books are printed from the spine atlas.
 */

/** Sleeve proportions. A 12" record is square and about 3 mm in its sleeve. */
const SLEEVE = 0.315
const THICKNESS = 0.004
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
  crate: string
  x: number
  y: number
  z: number
  rotationY: number
  /** Radians of lean back against the crate, varied so a bay is not a slab. */
  lean: number
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

  /**
   * Deal the collection into whatever crates the room has, in document order.
   * A crate that runs out of records simply has room in it.
   */
  const filed = useMemo<Filed[]>(() => {
    if (!world || tracks.length === 0) return []
    const crates = world.furniture.filter((item) => item.kind === 'recordshelf')
    if (crates.length === 0) return []

    const out: Filed[] = []
    let cursor = 0

    for (const crate of crates) {
      // Records lean back against the divider, filling each bay front to back.
      const usable = crate.depth - 0.09
      const perBay = Math.max(1, Math.floor(usable / (THICKNESS + GAP)))
      const cos = Math.cos(crate.rotationY)
      const sin = Math.sin(crate.rotationY)

      for (let slot = 0; slot < perBay * 2 && cursor < tracks.length; slot++, cursor++) {
        const track = tracks[cursor]!
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
          art: sleeveArtFor(track),
        })
      }
    }

    return out
  }, [world, tracks])

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
    quaternion.multiply(leanTurn.setFromAxisAngle(LEAN_AXIS, item.lean))
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
    const uvRect = new Float32Array(capacity * 4)
    for (let i = 0; i < capacity; i++) {
      const item = filed[i]
      const slot = item && i < ASSIGNABLE_SLOTS ? FIRST_ASSIGNABLE + i : null
      if (item && slot !== null) atlas.draw(slot, item.art)
      const rect = slot !== null ? atlas.rect(slot) : atlas.blank
      uvRect.set(rect, i * 4)
    }
    atlas.commit()
    geometry.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(uvRect, 4))
  }, [capacity, filed, atlas, geometry])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    if (lift.current.length !== capacity) lift.current = new Float32Array(capacity)
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
    const rate = Math.min(1, delta * 10)
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
