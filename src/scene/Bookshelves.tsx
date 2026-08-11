import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MATERIALS } from './materials'
import { sceneRefs, type ShelfGroup } from './refs'
import { SHELF, rowMetrics } from '../world/shelf'
import type { DerivedShelf } from '../world/derive'
import { useWorldStore } from '../state/world'

/**
 * Bookcases, one draw call per distinct shelf count.
 *
 * A case with four compartments is a different carcass from one with six, so
 * they cannot share an InstancedMesh — but a library realistically uses one or
 * two row counts, so this is still one or two draw calls for the lot.
 */
function buildCarcass(rows: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const box = new THREE.BoxGeometry(w, h, d)
    box.translate(x, y, z)
    parts.push(box)
  }

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

  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('failed to merge bookshelf geometry')
  merged.computeBoundingSphere()
  return merged
}

/**
 * Cached at module scope rather than in a memo with a disposing effect. Under
 * Fast Refresh the effect cleanup runs while the memo survives, which disposes
 * the live geometry and silently empties every shelf until a hard reload. A
 * cache that is never disposed cannot get into that state, and there are only
 * ever a handful of distinct row counts.
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
      matrix.compose(new THREE.Vector3(shelf.x, 0, shelf.z), quaternion, one)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    // Written into the object the parent published, not into a fresh one: the
    // parent's effect runs *after* this, so registering through a callback
    // would be overwritten the moment the group list was republished.
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
      <meshStandardMaterial color={MATERIALS.carcass} roughness={0.74} metalness={0} />
    </instancedMesh>
  )
}

/** A group of same-height cases, plus the mesh drawing them once it exists. */
type Bucket = ShelfGroup & { shelves: DerivedShelf[] }

export function Bookshelves() {
  const world = useWorldStore((s) => s.world)

  /**
   * Grouped by row count, each group remembering which entry of `world.shelves`
   * every instance is, so a raycast hit can be turned back into the shelf it
   * struck.
   */
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
