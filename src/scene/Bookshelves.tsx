import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { block, join } from './geometry'
import { MATERIALS, woodGrainTexture } from './materials'
import { sceneRefs, type ShelfGroup } from './refs'
import { SHELF, rowMetrics } from '../world/shelf'
import type { DerivedShelf } from '../world/derive'
import { useWorldStore } from '../state/world'

/**
 * One draw call per distinct shelf count: a four-compartment carcass is a
 * different mesh from a six, but a library uses one or two row counts.
 */
function buildCarcass(rows: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) =>
    parts.push(block(w, h, d, x, y, z))

  const { width, depth, height, panel, board, back, plinth } = SHELF
  const innerW = width - 2 * panel
  const bodyH = height - plinth
  const bodyY = plinth + bodyH / 2
  const { surfaceY } = rowMetrics(rows)

  // Recessed toe kick, so the case does not look like it is floating.
  add(width - 0.03, plinth, depth - 0.05, 0, plinth / 2, -0.01)

  add(panel, bodyH, depth, -(width - panel) / 2, bodyY, 0)
  add(panel, bodyH, depth, (width - panel) / 2, bodyY, 0)
  add(width, bodyH, back, 0, bodyY, -depth / 2 + back / 2)
  add(innerW, board, depth, 0, height - board / 2, 0)
  add(innerW, board, depth, 0, plinth + board / 2, 0)

  for (let row = 1; row < rows; row++) {
    add(innerW, board, depth, 0, surfaceY(row) - board / 2, 0)
  }

  // Face frame: stiles down the front corners, a rail under every board.
  // Proud of the carcass so the front reads as joinery rather than plywood.
  const stile = 0.03
  const proud = 0.014
  const frontZ = depth / 2 + proud / 2
  add(stile, bodyH, proud, -(width - stile) / 2, bodyY, frontZ)
  add(stile, bodyH, proud, (width - stile) / 2, bodyY, frontZ)
  add(innerW, 0.03, proud, 0, height - board - 0.015, frontZ)
  for (let row = 1; row < rows; row++) {
    add(innerW, 0.03, proud, 0, surfaceY(row) - board - 0.015, frontZ)
  }

  const merged = join(parts)
  merged.computeBoundingSphere()
  return merged
}

/**
 * Module scope rather than a memo with a disposing effect: under Fast Refresh
 * the cleanup runs while the memo survives, which disposes the live geometry and
 * empties every shelf until a hard reload.
 */
const carcasses = new Map<number, THREE.BufferGeometry>()
const carcassFor = (rows: number) => {
  let geometry = carcasses.get(rows)
  if (!geometry) {
    geometry = buildCarcass(rows)
    carcasses.set(rows, geometry)
  }
  return geometry
}

/** One instanced mesh, holding every case that has this many shelves. */
function Group({ group }: { group: Bucket }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const geometry = carcassFor(group.rows)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)

    group.shelves.forEach((shelf, i) => {
      quaternion.setFromAxisAngle(axis, shelf.rotationY)
      // `shelf.y` is the floor the case stands on: hardcoding 0 sinks every
      // loft bookcase into the room below, leaving its books over nothing.
      matrix.compose(new THREE.Vector3(shelf.x, shelf.y, shelf.z), quaternion, one)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    // Into the object the parent published, not a fresh one: the parent's
    // effect runs after this, so a callback would be overwritten at once.
    group.mesh = mesh
    return () => {
      group.mesh = null
    }
  }, [group])

  return (
    <instancedMesh
      key={`${group.rows}:${group.shelves.length}`}
      ref={meshRef}
      args={[geometry, undefined, group.shelves.length]}
      castShadow
      receiveShadow
    >
      {/* Grain multiplied under the colour, the furniture convention. */}
      <meshStandardMaterial
        color={MATERIALS.carcass}
        roughness={0.74}
        metalness={0}
        map={woodGrainTexture()}
      />
    </instancedMesh>
  )
}

/** A group of same-height cases, plus the mesh drawing them once it exists. */
type Bucket = ShelfGroup & { shelves: DerivedShelf[] }

export function Bookshelves() {
  const world = useWorldStore((s) => s.world)

  /** Grouped by row count, each remembering its entries in `world.shelves`. */
  const groups = useMemo(() => {
    const byRows = new Map<number, Bucket>()
    world?.shelves.forEach((shelf, index) => {
      let bucket = byRows.get(shelf.rows)
      if (!bucket) {
        bucket = { rows: shelf.rows, indices: [], shelves: [], mesh: null }
        byRows.set(shelf.rows, bucket)
      }
      bucket.shelves.push(shelf)
      bucket.indices.push(index)
    })
    return [...byRows.values()].sort((a, b) => a.rows - b.rows)
  }, [world])

  useLayoutEffect(() => {
    sceneRefs.shelfGroups = groups
    return () => {
      sceneRefs.shelfGroups = []
    }
  }, [groups])

  if (!world) return null

  return (
    <group>
      {groups.map((entry) => (
        <Group key={entry.rows} group={entry} />
      ))}
    </group>
  )
}
