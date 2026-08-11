import * as THREE from 'three'
import type { DerivedWorld } from '../world/derive'
import { useWorldStore } from '../state/world'
import { useMemo } from 'react'

/**
 * World transform of every bookcase, and the direction out of its open face.
 *
 * Derived from the world document and shared by everything that has to place
 * something relative to a shelf — the instanced books, the spine labels, the
 * placement ghost, the crosshair. One source, so a shelf cannot be in two places.
 */
export type ShelfTransform = {
  quaternion: THREE.Quaternion
  matrix: THREE.Matrix4
  outward: THREE.Vector3
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

export function shelfTransforms(world: DerivedWorld): ShelfTransform[] {
  return world.shelves.map((shelf) => {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, shelf.rotationY)
    return {
      quaternion,
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(shelf.x, 0, shelf.z),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      ),
      outward: Z_AXIS.clone().applyQuaternion(quaternion),
    }
  })
}

/** Recomputed only when a new world document is applied. */
export function useShelfTransforms(): ShelfTransform[] {
  const world = useWorldStore((s) => s.world)
  return useMemo(() => (world ? shelfTransforms(world) : []), [world])
}
