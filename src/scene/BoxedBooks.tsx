import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRefs } from './refs'
import { packBoxes } from '../world/boxes'
import { useLibraryStore } from '../state/library'
import { useAppStore } from '../state/store'
import { useWorldStore } from '../state/world'

/**
 * The books in the moving boxes: everything not yet unpacked, plus whatever an
 * edit displaced. Pointable and takeable, exactly like a shelved book, because
 * putting them away is the whole point of them being visible.
 */
const HIGHLIGHT = new THREE.Color('#e6d3a6')
const Y_AXIS = new THREE.Vector3(0, 1, 0)
/** How far a focused book lifts out of the pile. */
const LIFT = 0.03

export function BoxedBooks() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const world = useWorldStore((s) => s.world)
  const boxes = useLibraryStore((s) => s.boxes)
  const dims = useLibraryStore((s) => s.dims)
  const held = useAppStore((s) => s.held)

  const packing = useMemo(
    () => (world ? packBoxes(world, boxes, (id) => dims.get(id)) : null),
    [world, boxes, dims],
  )
  const placed = packing?.placed ?? []

  const capacity = useMemo(
    () => Math.max(32, Math.ceil((placed.length + 32) / 64) * 64),
    [placed.length === 0],
  )

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
    const item = placed[i]
    const { matrix, position, quaternion, scale, colour, hidden } = scratch

    if (!item) {
      matrix.compose(position.set(0, -100, 0), quaternion.identity(), hidden)
      mesh.setMatrixAt(i, matrix)
      return
    }

    const amount = lift.current[i] ?? 0
    position.set(item.x, item.y + amount * LIFT, item.z)
    quaternion.setFromAxisAngle(Y_AXIS, item.rotationY)
    scale.set(item.size[0], item.size[1], item.size[2])
    matrix.compose(position, quaternion, held === item.id ? hidden : scale)
    mesh.setMatrixAt(i, matrix)

    colour.set(item.colour)
    if (amount > 0.001) colour.lerp(HIGHLIGHT, amount * 0.5)
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

    sceneRefs.boxedBooks = mesh
    sceneRefs.boxedIds = placed.map((item) => item.id)
    return () => {
      sceneRefs.boxedBooks = null
      sceneRefs.boxedIds = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, placed, held])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh || placed.length === 0) return
    const focused = useAppStore.getState().focusedBook
    const rate = Math.min(1, delta * 10)
    let dirty = false

    for (let i = 0; i < placed.length; i++) {
      const want = placed[i]!.id === focused ? 1 : 0
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
    <instancedMesh key={capacity} ref={meshRef} args={[undefined, undefined, capacity]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.72} metalness={0} />
    </instancedMesh>
  )
}
