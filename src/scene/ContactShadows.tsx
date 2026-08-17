import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { contactShadowTexture } from './materials'
import { useWorldStore } from '../state/world'
import type { DerivedFurniture } from '../world/derive'

/**
 * A soft dark ellipse under everything that stands on a floor.
 *
 * The shadow map grounds furniture only while shadows are on; without one, a
 * sofa floats a millimetre over the boards however exactly it is placed. One
 * instanced disc under every floor-standing piece fixes that for a single
 * draw call, and it is deliberately KEPT in Low Performance Mode — there it
 * is the only grounding the room gets. Static: matrices are rebuilt when the
 * world is, never per frame.
 */

/** Half-axes of the blob, per kind. Null is a kind that casts none. */
function radiiOf(item: DerivedFurniture): [number, number] | null {
  switch (item.kind) {
    case 'armchair':
      return [0.55, 0.55]
    case 'sofa':
      return [item.width / 2 + 0.1, 0.55]
    case 'table':
    case 'desk':
      return [item.width / 2 + 0.05, item.depth / 2 + 0.05]
    case 'bed':
      return [item.width / 2, item.depth / 2]
    case 'sidetable':
      return [0.33, 0.33]
    case 'footstool':
      return [0.3, 0.3]
    case 'diningchair':
      return [0.3, 0.3]
    case 'bench':
      return [item.width / 2, 0.28]
    case 'kitchencounter':
      return [item.width / 2, item.depth / 2]
    case 'fridge':
      return [0.45, 0.45]
    case 'recordshelf':
      return [item.width / 2, 0.3]
    case 'arcade':
      return [0.5, 0.5]
    case 'bin':
      return [0.2, 0.2]
    case 'plant':
      return [0.28, 0.28]
    case 'floorlamp':
      return [0.26, 0.26]
    case 'box':
      return [item.width / 2 + 0.03, item.depth / 2 + 0.03]
    // Everything else is hung, mounted on something, or too slight to pool
    // shade — a rug most of all, whose whole job is lying flush already.
    default:
      return null
  }
}

type Blob = { x: number; y: number; z: number; rx: number; rz: number; yaw: number }

/**
 * Never disposed, the carcass-cache argument: under Fast Refresh a disposing
 * effect can outlive the memo that rebuilt the geometry.
 */
let disc: THREE.BufferGeometry | null = null
function discGeometry(): THREE.BufferGeometry {
  if (!disc) {
    disc = new THREE.CircleGeometry(1, 16)
    disc.rotateX(-Math.PI / 2)
  }
  return disc
}

export function ContactShadows() {
  const world = useWorldStore((s) => s.world)
  const mesh = useRef<THREE.InstancedMesh>(null)

  const blobs = useMemo<Blob[]>(() => {
    if (!world) return []
    const out: Blob[] = []
    for (const item of world.furniture) {
      const radii = radiiOf(item)
      if (!radii) continue
      // `item.y` is the floor the piece stands on, whichever storey that is.
      out.push({
        x: item.x,
        y: item.y + 0.006,
        z: item.z,
        rx: radii[0],
        rz: radii[1],
        yaw: item.rotationY,
      })
    }
    for (const shelf of world.shelves) {
      out.push({ x: shelf.x, y: shelf.y + 0.006, z: shelf.z, rx: 0.68, rz: 0.28, yaw: shelf.rotationY })
    }
    return out
  }, [world])

  useLayoutEffect(() => {
    const node = mesh.current
    if (!node) return
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const size = new THREE.Vector3()
    blobs.forEach((blob, i) => {
      // The ellipse turns with the piece: non-uniform scale in its own frame.
      quaternion.setFromAxisAngle(up, blob.yaw)
      matrix.compose(position.set(blob.x, blob.y, blob.z), quaternion, size.set(blob.rx, 1, blob.rz))
      node.setMatrixAt(i, matrix)
    })
    node.instanceMatrix.needsUpdate = true
    node.computeBoundingSphere()
  }, [blobs])

  if (blobs.length === 0) return null
  return (
    <instancedMesh
      key={blobs.length}
      ref={mesh}
      args={[discGeometry(), undefined, blobs.length]}
    >
      <meshBasicMaterial
        color="#000000"
        transparent
        opacity={0.32}
        alphaMap={contactShadowTexture()}
        depthWrite={false}
      />
    </instancedMesh>
  )
}
