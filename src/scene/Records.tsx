import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { hashId } from '../data/dimensions'
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
 * order, and adding a file to `music/` puts it on the shelf.
 *
 * One instanced mesh for the lot, the same way the books work.
 */

/** Sleeve proportions. A 12" record is square and about 3 mm in its sleeve. */
const SLEEVE = 0.315
const THICKNESS = 0.004
const GAP = 0.0035
const HIGHLIGHT = new THREE.Color('#f0dcae')
const Y_AXIS = new THREE.Vector3(0, 1, 0)

const SLEEVE_COLOURS = [
  '#2f4257', '#6b2f3c', '#3f5a4a', '#8c5a2b', '#4a4038', '#5a3a55',
  '#334a52', '#7a6a44', '#775241', '#2b3a45', '#8d6b52', '#43506b',
]

type Filed = {
  id: string
  x: number
  y: number
  z: number
  rotationY: number
  colour: string
  /** How far this sleeve is pulled out of the crate, for the focused one. */
  crate: string
}

export function Records() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const tracks = useMediaStore((s) => s.tracks)

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
      // Records lean back against the divider, filling the crate front to back.
      const usable = crate.depth - 0.09
      const capacity = Math.max(1, Math.floor(usable / (THICKNESS + GAP)))
      const cos = Math.cos(crate.rotationY)
      const sin = Math.sin(crate.rotationY)

      for (let slot = 0; slot < capacity && cursor < tracks.length; slot++, cursor++) {
        const track = tracks[cursor]!
        const localZ = usable / 2 - slot * (THICKNESS + GAP)
        const hash = hashId(track.id)

        out.push({
          id: track.id,
          x: crate.x + localZ * sin,
          y: crate.y + 0.08 + SLEEVE / 2,
          z: crate.z + localZ * cos,
          // A very slight lean, so a full crate is not a solid block.
          rotationY: crate.rotationY,
          colour: SLEEVE_COLOURS[hash % SLEEVE_COLOURS.length]!,
          crate: crate.id,
        })
      }
    }

    return out
  }, [world, tracks])

  const capacity = useMemo(() => Math.max(32, Math.ceil((filed.length + 8) / 32) * 32), [
    Math.ceil((filed.length + 8) / 32),
  ])

  /** How far each sleeve is drawn up out of the crate, 0 to 1. */
  const lift = useRef<Float32Array>(new Float32Array(0))

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      colour: new THREE.Color(),
      hidden: new THREE.Vector3(0, 0, 0),
    }),
    [],
  )

  const write = (mesh: THREE.InstancedMesh, i: number) => {
    const item = filed[i]
    const { matrix, position, quaternion, scale, colour, hidden } = scratch
    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    const playing = useMediaStore.getState().playing === item.id
    position.set(item.x, item.y + amount * 0.07, item.z)
    quaternion.setFromAxisAngle(Y_AXIS, item.rotationY)
    // A record on the deck is not in the crate.
    scale.set(SLEEVE, SLEEVE, THICKNESS)
    matrix.compose(position, quaternion, playing ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    colour.set(item.colour)
    if (amount > 0.001) colour.lerp(HIGHLIGHT, amount * 0.6)
    mesh.setColorAt(i, colour)
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    lift.current = new Float32Array(capacity)
    for (let i = 0; i < capacity; i++) write(mesh, i)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    sceneRefs.records = mesh
    sceneRefs.recordIds = filed.map((item) => item.id)
    return () => {
      sceneRefs.records = null
      sceneRefs.recordIds = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, filed])

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
      args={[undefined, undefined, capacity]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.82} metalness={0} />
    </instancedMesh>
  )
}
