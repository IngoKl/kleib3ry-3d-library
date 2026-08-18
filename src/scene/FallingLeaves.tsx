import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { colorCorners, mixColor } from './ambienceBlend'
import { between, mulberry32 } from '../lib/rng'
import { GROUND_Y } from '../world/terrain'
import { useSettings } from '../state/settings'
import { useWorldStore } from '../state/world'

/**
 * A dozen recycled quads on the chimney smoke's clock. Each leaf falls for a
 * third of its cycle and hides at zero scale for the rest, so the drop stays a
 * detail you catch rather than weather; landing is a shrink, since the shared
 * material has one opacity for the lot.
 */

/** Seconds per leaf cycle; 30% of it falling is an ~8 s drop. */
const CYCLE = 28
const FALLING = 0.3

const LEAF_COLOUR = colorCorners({
  day: '#c9b458',
  dayRain: '#8f855c',
  night: '#3a3d33',
  nightRain: '#2e302b',
})
/** Pale, because an instance tint multiplies the blended base above. */
const LEAF_TINTS = ['#ffe9a8', '#f4d488', '#ffdc93', '#eecf9b']

type Leaf = {
  x: number
  z: number
  top: number
  phase: number
  wobble: number
  spinX: number
  spinY: number
}

export function FallingLeaves() {
  const world = useWorldStore((s) => s.world)
  const low = useSettings((s) => s.lowPerformance)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const material = useRef<THREE.MeshBasicMaterial>(null)

  // Only birches near the buildings: a leaf falling a hundred metres off is
  // frames spent on something nobody can see.
  const birches = useMemo(
    () =>
      (world?.trees ?? [])
        .filter((tree) => tree.species === 'birch' && Math.hypot(tree.x, tree.z) < 45)
        .slice(0, 8),
    [world],
  )

  const leaves = useMemo<Leaf[]>(() => {
    if (birches.length === 0) return []
    const random = mulberry32(0x1eaf)
    return Array.from({ length: 12 }, (_, i) => {
      const tree = birches[i % birches.length]!
      return {
        x: tree.x + between(random, -0.6, 0.6) * tree.spread,
        z: tree.z + between(random, -0.6, 0.6) * tree.spread,
        top: GROUND_Y + tree.height * 0.75,
        phase: random(),
        wobble: random() * Math.PI * 2,
        spinX: between(random, 1.2, 2.6),
        spinY: between(random, 0.8, 2.0),
      }
    })
  }, [birches])

  useLayoutEffect(() => {
    const node = mesh.current
    if (!node) return
    const colour = new THREE.Color()
    leaves.forEach((_, i) => node.setColorAt(i, colour.set(LEAF_TINTS[i % LEAF_TINTS.length]!)))
    if (node.instanceColor) node.instanceColor.needsUpdate = true
  }, [leaves])

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      size: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const node = mesh.current
    if (!node) return
    if (material.current) mixColor(material.current.color, LEAF_COLOUR)
    const t = clock.elapsedTime

    leaves.forEach((leaf, i) => {
      const age = (t / CYCLE + leaf.phase) % 1
      if (age >= FALLING) {
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.size.setScalar(0))
        node.setMatrixAt(i, scratch.matrix)
        return
      }
      const progress = age / FALLING
      scratch.position.set(
        leaf.x + Math.sin(t * 2.3 + leaf.wobble) * 0.4 * progress,
        leaf.top + (GROUND_Y - leaf.top) * progress,
        leaf.z + Math.cos(t * 2.3 + leaf.wobble) * 0.4 * progress,
      )
      scratch.euler.set(t * leaf.spinX + leaf.wobble, t * leaf.spinY, 0)
      scratch.quaternion.setFromEuler(scratch.euler)
      // Landing is a shrink: one shared opacity, so alpha cannot do it per leaf.
      const settled = progress > 0.92 ? (1 - progress) / 0.08 : 1
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.size.setScalar(settled))
      node.setMatrixAt(i, scratch.matrix)
    })
    node.instanceMatrix.needsUpdate = true
  })

  // A hand-set bound over the picked birches — the leaves never leave their
  // canopies' footprint, so the mesh culls while you face the shelves.
  useEffect(() => {
    const node = mesh.current
    if (!node || birches.length === 0) return
    const box = new THREE.Box3()
    for (const tree of birches) {
      box.expandByPoint(
        new THREE.Vector3(tree.x - tree.spread - 1, GROUND_Y, tree.z - tree.spread - 1),
      )
      box.expandByPoint(
        new THREE.Vector3(tree.x + tree.spread + 1, GROUND_Y + tree.height, tree.z + tree.spread + 1),
      )
    }
    node.boundingSphere = box.getBoundingSphere(new THREE.Sphere())
  }, [birches, leaves.length])

  if (low || leaves.length === 0) return null
  return (
    <instancedMesh key={leaves.length} ref={mesh} args={[undefined, undefined, leaves.length]}>
      <planeGeometry args={[0.07, 0.09]} />
      <meshBasicMaterial ref={material} side={THREE.DoubleSide} />
    </instancedMesh>
  )
}
